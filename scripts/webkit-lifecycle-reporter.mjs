// Only phase/status data, no titles, traces, form contents or application data.
// Compose with the original list/HTML/JSON reporters; never alter their results.
export default class WebKitLifecycleReporter {
  send(event, details = {}) {
    if (process.env.JLB_WEBKIT_SUPERVISED === '1' && process.connected)
      process.send({ type: 'jianlibao:webkit-lifecycle', event, ...details });
  }
  onBegin() { this.send('begin'); }
  onTestBegin(test) { this.send('test-begin', { timeout: test.timeout }); }
  onTestEnd(_test, result) { this.send('test-end', { status: result.status }); }
  onStepBegin(_test, _result, step) {
    if (!step.parent && step.category === 'hook' && step.title === 'After Hooks')
      this.send('after-hooks');
  }
  onEnd() { this.send('end'); }
}
