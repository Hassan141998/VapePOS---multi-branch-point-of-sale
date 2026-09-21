// jsbarcode ships a .d.ts that TypeScript cannot resolve from its package.json, so the parts we use are declared here.
declare module 'jsbarcode' {
  export interface JsBarcodeOptions {
    format?: string
    width?: number
    height?: number
    displayValue?: boolean
    fontSize?: number
    font?: string
    textMargin?: number
    background?: string
    lineColor?: string
    margin?: number
    marginTop?: number
    marginBottom?: number
    marginLeft?: number
    marginRight?: number
    flat?: boolean
  }
  export default function JsBarcode(target: SVGElement | string, text: string, options?: JsBarcodeOptions): void
}
