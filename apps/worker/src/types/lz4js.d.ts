declare module "lz4js" {
  const lz4: {
    decompressBlock(
      input: Uint8Array,
      output: Uint8Array,
      sIdx?: number,
      eIdx?: number,
      oIdx?: number
    ): number;
  };

  export default lz4;
}
