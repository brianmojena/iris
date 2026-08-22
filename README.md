# Iris

Editor de fotos que funciona por completo en el navegador. No hay servidor, no hay
cuentas y ninguna imagen sale del dispositivo.

```bash
npm install
npm run dev
```

## Estado

**Fase 1 completa.** Carga de imagen, motor de render WebGL2, los diez ajustes
básicos de luz y color, zoom y desplazamiento, comparación con el original,
historial y exportación.

Pendiente para las siguientes fases: recorte y geometría, detalle y efectos
(nitidez, ruido, grano, viñeta), panel de historial visible y persistencia de
proyectos en IndexedDB.

## Cómo está construido

Todo el procesamiento ocurre en la GPU a través de un único paso de fragment
shader. El estado de la edición es un objeto plano y serializable
(`src/types/adjustments.ts`); ninguna herramienta toca píxeles, solo escribe en
ese objeto. De ahí salen gratis la edición no destructiva, el historial y —más
adelante— los ajustes preestablecidos y el copiar/pegar entre fotos.

```
src/
  engine/
    Renderer.ts              contexto GL, textura de origen, un draw call
    gl/program.ts            compilado, enlazado y caché de uniforms
    shaders/                 el pipeline de color, en GLSL
  lib/
    decode.ts                apertura de archivos, HEIC, orientación EXIF
    export.ts                render a tamaño completo y descarga
  state/editorStore.ts       estado, historial, deshacer/rehacer
  components/                interfaz
```

La vista previa y la exportación pasan por el **mismo** `Renderer` a distinto
tamaño. No existe un segundo camino de render que pudiera divergir de lo que se
ve en pantalla.

### El pipeline de color

El orden imita al de un procesador raw:

1. Se decodifica a luz lineal.
2. Exposición y balance de blancos, que solo tienen sentido físico en lineal.
3. Se vuelve a gamma de pantalla.
4. Rango tonal, contraste y saturación, que son perceptuales.

Las tres decisiones que costaron encontrar, documentadas en el shader:

- Los ajustes tonales mueven la **luminancia** y reconstruyen el color por
  escalado. Sumar un desplazamiento plano parece más simple pero dispara el croma
  aparente al recuperar altas luces.
- Ese escalado va **acotado al aclarar** (`MAX_GAIN`). Sin el tope, levantar un
  píxel casi negro exige un factor de 20× o más, los canales saturan por separado
  y el tono se invierte.
- El croma **decae con la distancia recorrida** por el píxel. Conservarlo entero
  al comprimir el rango produce un split-tone neón de manual.

## Formatos

Entrada: JPEG, PNG, WebP, AVIF y HEIC de iPhone. La decodificación HEIC usa
WebAssembly y se carga bajo demanda: son unos 700 KB comprimidos que solo se
descargan la primera vez que se abre un archivo de ese tipo.

Salida: JPEG, WebP o PNG, con calidad y tamaño máximo configurables. El tamaño
que muestra el diálogo es el real, no una estimación.

Las imágenes que superan el máximo de textura de la GPU se reducen al abrirlas y
se avisa de ello.

## Atajos

| | |
|---|---|
| `⌘Z` / `⇧⌘Z` | Deshacer y rehacer |
| `⌘E` | Exportar |
| `\` | Mantener pulsado para ver el original |
| Doble clic en un slider | Devolverlo a su valor por defecto |
| Doble clic en la foto | Alternar entre ajustar y 200% |
| `←` `→` sobre un slider | Ajuste fino (`⇧` para pasos de diez) |
| Pegar | Abre una imagen del portapapeles |

## Licencia

[MIT](LICENSE) — Copyright (c) 2026 Brian Mojena.

Úsalo, modifícalo y distribúyelo con libertad, también con fines comerciales.
Lo único que se pide es conservar el aviso de copyright.
