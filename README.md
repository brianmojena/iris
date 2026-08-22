# Iris

Editor de fotos que funciona por completo en el navegador. No hay servidor, no hay
cuentas y ninguna imagen sale del dispositivo.

```bash
npm install
npm run dev
```

## Estado

**MVP completo.** Carga de imagen, motor de render WebGL2, quince controles
repartidos en luz, color, detalle y efectos, editor de recorte con proporciones
fijas y enderezado, zoom y desplazamiento, comparación con el original,
historial y exportación.

Pendiente: panel de historial visible y persistencia de proyectos en IndexedDB.

## Cómo está construido

Todo el procesamiento ocurre en la GPU a través de un único paso de fragment
shader. El estado de la edición es un objeto plano y serializable
(`src/types/adjustments.ts`); ninguna herramienta toca píxeles, solo escribe en
ese objeto. De ahí salen gratis la edición no destructiva, el historial y —más
adelante— los ajustes preestablecidos y el copiar/pegar entre fotos.

```
src/
  engine/
    Renderer.ts              contexto GL, textura de origen, cadena de pasadas
    gl/program.ts            compilado, enlazado y caché de uniforms
    gl/target.ts             superficies fuera de pantalla entre pasadas
    shaders/                 el pipeline, en GLSL
  lib/
    decode.ts                apertura de archivos, HEIC, orientación EXIF
    export.ts                render a tamaño completo y descarga
    matrix.ts                afín 3×3, en el orden que espera WebGL
    crop.ts                  arrastre de tiradores y proporciones
  types/geometry.ts          encuadre: giros, volteos, enderezado, recorte
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

### El encuadre

Recorte, giro, volteo y enderezado se resuelven en **una sola matriz 3×3** que el
shader aplica a las coordenadas de textura. No se mueven píxeles y no hay pasos
intermedios: la imagen se muestrea una vez, desde el original, sea cual sea la
combinación de transformaciones. El borde inclinado que deja el enderezado se
suaviza con `fwidth`, que da el tamaño de un píxel de salida medido en espacio de
origen.

Dos decisiones que no son evidentes:

- `geometry.crop` guarda **lo que el usuario pidió**, no lo que se ve. El encuadre
  real se calcula al vuelo ajustándolo al rectángulo inclinado. Si se recortara el
  valor guardado, mover el control de enderezar de ida y vuelta iría comiéndose la
  foto, porque ese ajuste solo sabe encoger.
- El volteo se aplica **después** de los giros de 90°, de modo que «voltear
  horizontalmente» siempre refleja izquierda-derecha en pantalla, con
  independencia de cuántos cuartos de giro haya acumulados. Además invierte el
  ángulo de enderezado, para que se refleje la composición entera y no solo su
  contenido.

### Las pasadas

El color se resuelve en una sola pasada. Nitidez, reducción de ruido y
desenfoque no pueden: necesitan píxeles vecinos, así que cuando alguno entra en
juego la cadena crece —color a una textura fuera de pantalla, luego las pasadas
espaciales, luego una final a la pantalla—. Las pasadas que no tienen nada que
hacer se saltan, de modo que una foto sin efectos sigue costando un solo
`drawArrays`. Con la cadena completa a 3 MP el arrastre de un control se mantiene
en 60 fps.

Las superficies intermedias son de 8 bits a propósito. Con media coma flotante se
arrastraría algo más de precisión, pero una exportación de 24 megapíxeles necesita
tres vivas a la vez, y a ocho bytes por píxel eso pasa de medio gigabyte de
memoria de GPU para un archivo que el usuario espera simplemente guardar.

Tres detalles que costaron encontrar:

- Dibujar a un framebuffer **invierte Y** respecto a dibujar al canvas. El vertex
  shader voltea la coordenada para compensar que los bitmaps van de arriba abajo;
  con dos pasadas ese volteo se aplicaba una vez de más. Ahora es un uniform:
  solo voltea la pasada que lee el bitmap original.
- El hash de ruido habitual, `sin`-`dot`-`fract`, se distribuye pésimamente con
  entradas enteras —y los índices de celda del grano lo son—. No añadía textura:
  desplazaba el brillo medio de un cielo liso en cincuenta niveles.
- El grano se atenúa con la reducción de escala del preview. Sin eso, la vista
  previa mostraba mucho más grano del que acababa teniendo el archivo.

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
| `C` | Entrar y salir del recorte |
| `Esc` | Salir del recorte |
| Doble clic en un slider | Devolverlo a su valor por defecto |
| Doble clic en la foto | Alternar entre ajustar y 200% |
| `←` `→` sobre un slider | Ajuste fino (`⇧` para pasos de diez) |
| Pegar | Abre una imagen del portapapeles |

## Licencia

[MIT](LICENSE) — Copyright (c) 2026 Brian Mojena.

Úsalo, modifícalo y distribúyelo con libertad, también con fines comerciales.
Lo único que se pide es conservar el aviso de copyright.
