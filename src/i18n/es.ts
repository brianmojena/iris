/**
 * The Spanish dictionary is the source of truth: the interface was written in
 * Spanish first, so every other language is typed against this shape and a
 * missing key is a build error rather than a blank label at runtime.
 */
export const es = {
  code: 'es',
  name: 'Español',

  app: {
    open: 'Abrir',
    export: 'Exportar',
    undo: 'Deshacer',
    redo: 'Rehacer',
    undoHint: 'Deshacer (⌘Z)',
    redoHint: 'Rehacer (⇧⌘Z)',
    compare: 'Original',
    compareHint: 'Mantén pulsado para ver el original (\\)',
    compareLabel: 'Comparar con el original',
    opening: 'Abriendo…',
    language: 'Idioma',
    tools: 'Herramientas',
  },

  tabs: { adjust: 'Ajustes', crop: 'Recorte', history: 'Historial' },

  dropzone: {
    title: 'Arrastra una foto aquí',
    or: 'o',
    choose: 'selecciona un archivo',
    privacy: 'Todo se procesa en tu dispositivo. Nada se sube a ningún servidor.',
    formats: 'JPEG · PNG · WebP · HEIC',
    replace: 'Suelta para abrir otra foto',
  },

  groups: { light: 'Luz', color: 'Color', detail: 'Detalle', effects: 'Efectos' },

  adjustments: {
    exposure: 'Exposición',
    contrast: 'Contraste',
    highlights: 'Altas luces',
    shadows: 'Sombras',
    whites: 'Blancos',
    blacks: 'Negros',
    temperature: 'Temperatura',
    tint: 'Matiz',
    vibrance: 'Intensidad',
    saturation: 'Saturación',
    sharpness: 'Nitidez',
    denoise: 'Reducción de ruido',
    blur: 'Desenfoque',
    vignette: 'Viñeta',
    grain: 'Grano',
  },

  panel: {
    reset: 'Restablecer',
    emptyAdjust: 'Abre una foto para empezar a editar.',
    emptyCrop: 'Abre una foto para recortarla.',
    emptyHistory: 'Abre una foto para ver su historial.',
  },

  presets: {
    title: 'Preajustes',
    save: 'Guardar',
    placeholder: 'Nombre del preajuste',
    cancel: 'Cancelar',
    saveHint: 'Guardar los ajustes actuales',
    saveDisabled: 'Ajusta algo antes de guardarlo como preajuste',
    remove: 'Borrar el preajuste {name}',
    builtIn: {
      warm: 'Cálido',
      cool: 'Frío',
      punch: 'Contrastado',
      matte: 'Mate',
      bw: 'Blanco y negro',
      film: 'Película',
    },
  },

  crop: {
    aspect: 'Proporción',
    orientation: 'Orientación',
    straighten: 'Enderezar',
    result: 'Resultado: {width} × {height} px',
    done: 'Listo',
    rotateLeft: 'Girar a la izquierda',
    rotateRight: 'Girar a la derecha',
    flipH: 'Voltear horizontalmente',
    flipV: 'Voltear verticalmente',
    free: 'Libre',
    original: 'Original',
  },

  history: {
    backToOriginal: 'Volver al original',
    initial: 'Original',
    adjustmentsReset: 'Ajustes restablecidos',
    adjustmentsMultiple: 'Varios ajustes',
    geometryReset: 'Encuadre restablecido',
    crop: 'Recorte',
    rotateRight: 'Giro a la derecha',
    rotateLeft: 'Giro a la izquierda',
    flipH: 'Volteo horizontal',
    flipV: 'Volteo vertical',
    straighten: 'Enderezado {angle}°',
    aspect: 'Proporción {label}',
    aspectFree: 'Proporción libre',
    aspectCustom: 'Proporción personalizada',
    preset: 'Preajuste: {name}',
  },

  export: {
    title: 'Exportar',
    format: 'Formato',
    size: 'Tamaño',
    original: 'Original',
    quality: 'Calidad',
    cancel: 'Cancelar',
    download: 'Descargar',
    working: 'Exportando…',
    dimensions: '{width} × {height} px',
    label: 'Exportar imagen',
  },

  stage: {
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fit: 'Ajustar a la ventana',
    original: 'Original',
  },

  notices: {
    close: 'Cerrar aviso',
    sessionRestored: 'Recuperada la sesión anterior.',
    downscaled:
      'La imagen se redujo a {width}×{height} px para poder procesarla en tu GPU.',
    openFailed: 'No se pudo abrir la imagen.',
    exportFailed: 'La exportación falló.',
    unsupportedFormat: 'Formato no soportado: {type}',
    unknownFormat: 'desconocido',
    heicFailed:
      'No se pudo leer el archivo HEIC. Puede estar dañado o usar una variante no soportada.',
    noWebgl: 'Tu navegador no soporta WebGL2.',
    contextLost: 'Se perdió el contexto gráfico. Recargando el editor…',
    contextUnrecoverable: 'No se pudo restaurar WebGL. Recarga la página.',
    gpuMemory: 'No se pudo reservar memoria en la GPU.',
    textureFailed: 'No se pudo crear la textura.',
    shaderFailed: 'No se pudo crear el shader.',
    programFailed: 'No se pudo crear el programa.',
  },
}

/**
 * Every other language is typed against this. Note the absence of `as const`:
 * with it, each string would freeze into its own literal type and no
 * translation could ever satisfy the shape.
 */
export type Dictionary = typeof es
