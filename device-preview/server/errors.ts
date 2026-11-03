export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewError";
  }
}
export function publicError(error: unknown): string {
  if (error instanceof PreviewError) return error.message;
  return "设备预览失败，请刷新设备状态后重试";
}
