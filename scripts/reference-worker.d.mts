export interface ReferenceAssetSpec {
  url: string;
  mime: string;
  bytes: number;
  sha256: string;
}
export function validReferenceResponse(
  response: Response | undefined,
  asset: ReferenceAssetSpec,
): Promise<boolean>;
export function rangeResponse(
  response: Response,
  header: string,
): Promise<Response>;
export function validRasterResponse(
  response: Response | undefined,
): Promise<boolean>;
export function referenceWorkerSource(manifest: {
  version: string;
  assets: readonly ReferenceAssetSpec[];
}): string;
