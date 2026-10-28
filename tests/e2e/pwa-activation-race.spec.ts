import {test,expect} from '@playwright/test';
import {createServer,request,type ClientRequest} from 'node:http';
import {pipeline} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {listenForBrowser,storedWorkspace} from './helpers';

test('首次安装期间开始的刷新仍被接管，离线重载保留全部数据',async({page,context,baseURL},info)=>{
  const upstream=new URL(baseURL!);
  if(upstream.protocol!=='http:'||upstream.hostname!=='127.0.0.1')throw Error('Local preview required');
  let releaseAsset!:()=>void,releaseDocument!:()=>void,documentHeld!:()=>void;
  const assetGate=new Promise<void>(r=>releaseAsset=r),documentGate=new Promise<void>(r=>releaseDocument=r),held=new Promise<void>(r=>documentHeld=r);
  const pending=new Set<ClientRequest>();let holdDocument=false;
  const server=createServer((req,res)=>{void(async()=>{
    const destination=new URL(req.url!,upstream);
    if(destination.origin!==upstream.origin){res.writeHead(400);res.end();return;}
    const path=destination.pathname;
    if(path==='/probe'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Observer</title>');return;}
    if(path==='/sw.js'){
      const source=await readFile('dist/sw.js','utf8');
      // Read-only native ownership observer. It must never claim clients,
      // prepare caches, or send the production status handshake itself.
      const observer=`\nself.addEventListener('message',event=>{
        if(event.data?.type!=='jianlibao-test-client-status'||!event.ports[0])return;
        event.waitUntil(self.clients.matchAll({includeUncontrolled:false,type:'window'}).then(clients=>{
          event.ports[0].postMessage({controlled:clients.some(client=>client.id===event.source?.id)});
        }));
      });`;
      res.writeHead(200,{'Content-Type':'application/javascript'});res.end(source+observer);return;
    }
    // Hold an actual install asset, not the page's normal manifest request.
    if(path==='/manifest.webmanifest'&&req.headers['sec-fetch-dest']==='empty')await assetGate;
    if(path==='/'&&holdDocument){documentHeld();await documentGate;}
    const remote=request(destination,{headers:{...req.headers,host:upstream.host}},response=>{
      res.writeHead(response.statusCode!,response.headers);pipeline(response,res,()=>{});
    });
    pending.add(remote);remote.on('close',()=>pending.delete(remote));
    remote.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    res.on('close',()=>remote.destroy());remote.end();
  })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});
  const origin=await listenForBrowser(server);
  try{
    await page.goto(origin);await expect(page.getByRole('button',{name:'开始今天的训练',exact:true})).toBeEnabled();
    await expect.poll(()=>page.evaluate(async()=>(await navigator.serviceWorker.getRegistration())?.installing?.state)).toBe('installing');
    const before=await storedWorkspace(page);
    const observer=await context.newPage();await observer.goto(origin+'/probe');
    holdDocument=true;const navigation=page.reload();await held;
    releaseAsset();
    await expect.poll(()=>observer.evaluate(async()=>(await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
    releaseDocument();await navigation;
    await expect(page.getByRole('button',{name:'开始今天的训练',exact:true})).toBeEnabled();
    // Windows WebKit can leave the getter stale during this deliberately
    // interrupted navigation. Assert actual ownership by this document's ID;
    // removing the production reclaim still makes this assertion fail in Edge.
    await expect.poll(()=>page.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration();
      if(!registration?.active)return false;
      return new Promise<boolean>(resolve=>{
        const channel=new MessageChannel();let settled=false;
        const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
        const timer=setTimeout(()=>finish(false),500);
        channel.port1.onmessage=event=>finish(event.data?.controlled===true);
        channel.port1.onmessageerror=()=>finish(false);
        try{registration.active!.postMessage({type:'jianlibao-test-client-status'},[channel.port2]);}
        catch{finish(false);}
      });
    })).toBe(true);
    expect(await storedWorkspace(page)).toEqual(before);
    await observer.close();await context.setOffline(true);await page.reload();
    await expect(page.getByRole('button',{name:'开始今天的训练',exact:true})).toBeEnabled();
    expect(await storedWorkspace(page)).toEqual(before);
    await page.screenshot({path:info.outputPath('activation-race-offline.png'),animations:'disabled'});
  }finally{
    releaseAsset();releaseDocument();
    try { await context.setOffline(false); }
    finally {
      for(const remote of pending)remote.destroy();server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  }
});
