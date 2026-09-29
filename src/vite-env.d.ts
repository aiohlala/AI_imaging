/// <reference types="vite/client" />

declare module 'gifenc' {
  export function GIFEncoder(opts?: any): {
    writeFrame: (index: any, width: number, height: number, opts?: any) => void
    finish: () => void
    bytes: () => Uint8Array
  }
  export function quantize(rgba: any, maxColors: number): any
  export function applyPalette(rgba: any, palette: any): any
}
