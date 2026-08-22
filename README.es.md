# Iris

*[English](README.md) · Español*

Editor de fotos que funciona por completo en el navegador. No hay servidor, no hay
cuentas y ninguna imagen sale del dispositivo.

**[Pruébalo →](https://brianmojena.github.io/iris/)**

```bash
npm install
npm run dev
```

## Estado

**MVP completo, más historial, persistencia e interfaz bilingüe.** Quince
controles repartidos en luz, color, detalle y efectos; editor de recorte con
proporciones fijas y enderezado; panel de historial navegable; preajustes propios
y de fábrica; la sesión se recupera sola al volver; y la interfaz habla español e
inglés.

El MVP acordado está terminado. Lo que queda son mejoras, no huecos.

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
  i18n/                      diccionarios y detección de idioma
  lib/
    decode.ts                apertura de archivos, HEIC, orientación EXIF
    storage.ts               sesión y preajustes en IndexedDB
    describe.ts              etiqueta cada paso del historial a partir del diff
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
- El grano se atenúa con la reducción de escala del preview. Sin eso, la vista
  previa mostraba mucho más grano del que acababa teniendo el archivo.

Y una corrección: durante el desarrollo atribuí un desplazamiento del brillo
medio al hash de ruido, y **era falso**. Lo causaba el volteo en Y de arriba; yo
medía una zona que, invertida, mostraba otro contenido. Las pruebas de la fase 6
lo destaparon al comprobar que el hash «malo» no falla ningún test. El hash
actual se mantiene por un motivo distinto y honesto: la precisión de `sin()`
varía entre drivers, y evitarlo hace el grano reproducible en cualquier GPU.

### El historial y la sesión

El historial es **una lista con un puntero**, no dos pilas. Deshacer y rehacer
mueven el puntero; el panel deja saltar a cualquier punto pinchándolo. Editar
desde un punto intermedio descarta la rama que quedaba por delante, que es lo que
hace cualquier editor y lo que la gente espera.

Las etiquetas de cada paso —«Exposición +0,30», «Giro a la derecha»— se **derivan
del diff** entre estados, no se pasan a mano en cada llamada. Una etiqueta escrita
a mano acaba, tarde o temprano, contando algo distinto de lo que el paso hizo.

Al cerrar la pestaña se guarda en IndexedDB el archivo original tal cual llegó,
junto con la lista completa de pasos. Guardar solo el estado final habría
devuelto la foto pero dejado el deshacer apuntando a nada, y «sigues donde lo
dejaste» dejaría de ser cierto en cuanto pulsaras ⌘Z. La escritura va con retardo:
guardar en cada movimiento de un control significaría serializar un blob de
varios megabytes docenas de veces por segundo.

El almacenamiento es una comodidad, nunca un requisito. En navegación privada, con
el disco lleno o con IndexedDB deshabilitado, cada operación se traga su fallo y
el editor sigue funcionando en memoria.

### Los idiomas

Sin librería: un diccionario tipado por idioma y unas 130 cadenas. El español es
la fuente de la verdad y el inglés se tipa contra su forma, de modo que **olvidar
una traducción es un error de compilación**, no una etiqueta en blanco en
producción. Se detecta el idioma del navegador y la elección explícita se
recuerda.

Lo que obligó a pensar:

- Las etiquetas del historial **se guardan en disco**, así que no pueden ser
  texto ya traducido: una sesión grabada en español seguiría hablando español
  después de cambiar a inglés. Se guarda un descriptor —qué control, qué valor—
  y el panel lo convierte en palabras al pintarlo.
- Los números se escriben distinto en cada idioma. Los controles muestran
  `+0,60` en español y `+0.60` en inglés, vía `Intl.NumberFormat`. Es el tipo de
  detalle pequeño que hace que una interfaz se sienta traducida en vez de
  escrita.

## Pruebas

```bash
npx playwright install chromium   # una sola vez
npm test
```

Treinta y siete pruebas que corren en un Chromium headless, en menos de un
segundo. No hay pruebas de interfaz: el riesgo de este proyecto está en los
shaders y en la geometría, y eso no se puede afirmar nada sobre ello en un DOM
simulado. Cada prueba renderiza una imagen conocida por el mismo camino que usa
el botón de exportar y comprueba estadísticas de píxeles.

Las imágenes de prueba se construyen en código con un generador sembrado, no se
guardan como ficheros: un binario en el repositorio es opaco al revisarlo y
acaba desalineado de lo que pretendía demostrar.

Las pruebas se validaron **reintroduciendo los fallos reales** que aparecieron
durante el desarrollo, para comprobar que fallan cuando deben. Ese ejercicio
encontró dos cosas: que el test del grano no detectaba nada porque medía sobre un
degradado cuya pendiente enmascaraba el sesgo, y que uno de los diagnósticos del
README era falso (ver la nota en «Las pasadas»).

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

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md). En corto: lo interesante está en el
pipeline, las pruebas son rápidas, y los comentarios explican *por qué*, no qué.

## Licencia

[MIT](LICENSE) — Copyright (c) 2026 Brian Mojena.

Úsalo, modifícalo y distribúyelo con libertad, también con fines comerciales.
Lo único que se pide es conservar el aviso de copyright.
