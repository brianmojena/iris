export class DecodeError extends Error {}

export interface LoadedImage {
  bitmap: ImageBitmap
  /** Original file name without extension, used to name the export. */
  name: string
  /** Dimensions of the file on disk, before any safety downscale. */
  originalWidth: number
  originalHeight: number
  /** Set when the image had to be shrunk to fit GPU limits. */
  downscaled: boolean
}

const NATIVE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']

export const ACCEPTED_FILE_TYPES = [...NATIVE_TYPES, 'image/heic', 'image/heif'].join(',')

function isHeic(blob: Blob, name: string): boolean {
  const type = blob.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  // iOS sometimes hands over an empty MIME type, so fall back to the extension.
  return /\.(heic|heif)$/i.test(name)
}

/**
 * HEIC support costs about a megabyte of WebAssembly, so it is only fetched the
 * first time somebody actually drops a photo straight from an iPhone.
 */
async function decodeHeic(blob: Blob): Promise<Blob> {
  const { heicTo } = await import('heic-to')
  try {
    return await heicTo({ blob, type: 'image/png' })
  } catch (cause) {
    throw new DecodeError(
      'No se pudo leer el archivo HEIC. Puede estar dañado o usar una variante no soportada.',
      { cause },
    )
  }
}

/**
 * Very large photos can exceed the GPU's maximum texture size. Rather than fail,
 * we shrink to fit and tell the caller, so the UI can mention it.
 */
async function fitToLimit(bitmap: ImageBitmap, limit: number): Promise<ImageBitmap> {
  const largest = Math.max(bitmap.width, bitmap.height)
  if (largest <= limit) return bitmap

  const scale = limit / largest
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  })
  bitmap.close()
  return resized
}

/** Largest texture the current GPU accepts, cached after the first query. */
let textureLimit: number | null = null

function maxTextureSize(): number {
  if (textureLimit !== null) return textureLimit
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2')
  const limit: number = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096
  textureLimit = limit
  return limit
}

/**
 * Decodes an image that is already in hand as a blob.
 *
 * Restoring a saved session goes through here: the original bytes were kept, so
 * the restored photo is bit-identical to what was opened, HEIC included.
 */
export async function decodeBlob(blob: Blob, name: string): Promise<LoadedImage> {
  const heic = isHeic(blob, name)
  const source: Blob = heic ? await decodeHeic(blob) : blob

  if (!heic && !NATIVE_TYPES.includes(blob.type)) {
    throw new DecodeError(`Formato no soportado: ${blob.type || 'desconocido'}`)
  }

  let decoded: ImageBitmap
  try {
    decoded = await createImageBitmap(source, {
      // Honour the EXIF rotation iPhones write instead of rotating pixels.
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'none',
    })
  } catch (cause) {
    throw new DecodeError('No se pudo abrir la imagen.', { cause })
  }

  const originalWidth = decoded.width
  const originalHeight = decoded.height
  const bitmap = await fitToLimit(decoded, maxTextureSize())

  return {
    bitmap,
    name: name.replace(/\.[^.]+$/, '') || 'imagen',
    originalWidth,
    originalHeight,
    downscaled: bitmap.width !== originalWidth,
  }
}

export function loadImageFile(file: File): Promise<LoadedImage> {
  return decodeBlob(file, file.name)
}
