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

function isHeic(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  // iOS sometimes hands over an empty MIME type, so fall back to the extension.
  return /\.(heic|heif)$/i.test(file.name)
}

/**
 * HEIC support costs about a megabyte of WebAssembly, so it is only fetched the
 * first time somebody actually drops a photo straight from an iPhone.
 */
async function decodeHeic(file: File): Promise<Blob> {
  const { heicTo } = await import('heic-to')
  try {
    return await heicTo({ blob: file, type: 'image/png' })
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

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const source: Blob = isHeic(file) ? await decodeHeic(file) : file

  if (!isHeic(file) && !NATIVE_TYPES.includes(file.type)) {
    throw new DecodeError(`Formato no soportado: ${file.type || 'desconocido'}`)
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
    name: file.name.replace(/\.[^.]+$/, '') || 'imagen',
    originalWidth,
    originalHeight,
    downscaled: bitmap.width !== originalWidth,
  }
}
