export const tracing = {
  enterSpan<T>(
    _name: string,
    callback: (span: { readonly isTraced: boolean; setAttribute(): void; end(): void }) => T,
  ): T {
    return callback({ isTraced: false, setAttribute() {}, end() {} });
  },
};