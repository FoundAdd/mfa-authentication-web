/** Ambient type declarations for @capacitor-mlkit/barcode-scanning (pre-install). */

declare module '@capacitor-mlkit/barcode-scanning' {
  export interface Barcode {
    rawValue?: string
    displayValue?: string
    format?: string
  }

  export interface BarcodeScannerEvent {
    barcode?: Barcode
    barcodeDisplayValue?: string
  }

  export interface ListenerHandle {
    remove: () => void
  }

  export interface BarcodeScannerPlugin {
    requestPermissions: () => Promise<{ camera?: 'granted' | 'denied' | 'prompt' }>
    checkPermissions: () => Promise<{ camera?: 'granted' | 'denied' | 'prompt' }>
    installGoogleBarcodeScannerModuleIfNeeded: () => Promise<void>
    addListener: (
      eventName: 'barcodeScanned',
      handler: (event: BarcodeScannerEvent) => void,
    ) => Promise<ListenerHandle>
    startScanning: (options?: {
      formats?: number[]
      cameraDirection?: 'front' | 'back'
    }) => Promise<void>
    stopScanning: () => Promise<void>
    isTorchAvailable: () => Promise<{ available: boolean }>
    isTorchEnabled: () => Promise<{ enabled: boolean }>
    setTorchMode: (options: { enabled: boolean }) => Promise<void>
  }

  export const BarcodeScanner: BarcodeScannerPlugin
}