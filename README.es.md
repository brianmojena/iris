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

**MVP completo, más historial, persistencia, interfaz bilingüe y etalonaje.**
Quince controles repartidos en luz, color, detalle y efectos; una pestaña de
color con cuatro ruedas y cuatro curvas; hasta cuatro correcciones selectivas,
seleccionadas por color o acotadas con una ventana; histograma, forma de onda,
parade y vectorscopio flotando sobre la foto; editor de recorte con proporciones fijas y
enderezado; panel de historial navegable; preajustes propios y de fábrica; la
sesión se recupera sola al volver; y la interfaz habla español e inglés.

El MVP acordado está terminado. Lo que queda son mejoras, no huecos.

## Cómo está construido

Todo el procesamiento ocurre en la GPU a través de un único paso de fragment
shader. El estado de la edición es un objeto serializable
(`src/types/edit.ts`); ninguna herramienta toca píxeles, solo escribe en
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
    curve.ts                 spline monótona y la tabla de curvas
    scopes.ts                histograma, onda, parade, vectorscopio
  types/geometry.ts          encuadre: giros, volteos, enderezado, recorte
  types/grade.ts             ruedas y curvas, y la matemática de las ruedas
  types/secondary.ts         selecciones, ventanas y cómo llegan al shader
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
4. Rango tonal y contraste, que son perceptuales.
5. El grade: primero las ruedas de color, después las curvas.
6. Intensidad y saturación, que rematan lo que el grade haya dejado.
7. Los selectivos, cada uno alcanzando solo lo que su máscara cubre.

Las tres decisiones que costaron encontrar, documentadas en el shader:

- Los ajustes tonales mueven la **luminancia** y reconstruyen el color por
  escalado. Sumar un desplazamiento plano parece más simple pero dispara el croma
  aparente al recuperar altas luces.
- Ese escalado va **acotado al aclarar** (`MAX_GAIN`). Sin el tope, levantar un
  píxel casi negro exige un factor de 20× o más, los canales saturan por separado
  y el tono se invierte.
- El croma **decae con la distancia recorrida** por el píxel. Conservarlo entero
  al comprimir el rango produce un split-tone neón de manual.

### Ruedas y curvas

Cuatro ruedas y cuatro curvas, entre los controles tonales básicos y la
saturación final: el mismo sitio donde las pone un procesador raw.

Ninguna de las dos añade una pasada. Una curva es una función de un solo canal,
así que las cuatro se reducen a una fila RGBA de 256 entradas subida como
textura: la curva del canal y la maestra se componen exactamente, porque
`maestra(rojo(x))` sigue siendo una función del rojo. Eso es una lectura de
textura en lugar de dos. La tabla se reconstruye en la CPU solo cuando el objeto
de curvas cambia de identidad — el store lo reemplaza en cada cambio y nunca lo
edita en el sitio, así que una referencia que coincide es prueba de que la tabla
que hay en la GPU sigue siendo la buena.

La interpolación es **cúbica monótona** (Fritsch–Carlson), no Catmull-Rom ni una
spline natural. Las dos se pasan de largo: baja un punto y la curva se hunde por
debajo de él antes de llegar, lo que aparece como una banda oscura sobre un
degradado que nadie ha dibujado y de la que no hay forma de dar cuenta.

Las ruedas son lift, gamma, gain y offset, y cada una está anclada en un sitio
distinto — que es justamente la razón de que sean cuatro. La base desplaza todo
el rango, las sombras pivotan en el blanco y por eso caen sobre los oscuros, las
luces pivotan en el negro y por eso caen sobre los claros, y los medios dejan
clavados los dos extremos y doblan lo que hay entre ellos.

Dos decisiones dentro de eso:

- Al disco se le **resta la media**, de modo que cambia el equilibrio entre
  canales y nunca el brillo; el brillo lo mueve el anillo de debajo. Se puede
  perseguir una dominante sin ver cómo se va el brillo, y ajustar el brillo sin
  que el color lo siga.
- Medios y luces se miden en **pasos**. +1 duplica, −1 divide entre dos, y las
  dos direcciones se sienten igual. Un multiplicador lineal no.

Y un fallo que merece quedar escrito, porque es de los que se esconden. Subir la
tabla de curvas la dejaba enlazada a la unidad de textura que estuviera activa
—la 0, donde vive la fotografía—. A partir de ahí toda imagen se dibujaba como la
propia rampa de la tabla: de negro a blanco, de izquierda a derecha. Sobre la
rampa gris que usan las pruebas tonales eso es casi la respuesta correcta, y
setenta y dos pruebas pasaron mientras el editor mostraba un degradado gris en
lugar de la foto. La prueba de regresión mide un campo **plano**, donde una rampa
no tiene dónde esconderse.

### Selectivos: selección por color y ventanas

Un selectivo es una **máscara** y una **corrección**. La máscara sale de una
selección por color —un rango de tono, saturación y luminancia—, de una ventana
geométrica, o de las dos multiplicadas entre sí; la corrección es un juego
reducido de controles aplicado a través de lo que salga.

Hay un tope duro de cuatro, y corren dentro del mismo fragment shader que todo lo
demás, como un bucle sobre siete arrays de `vec4`. Ni una pasada más, ni una
textura más, ni un búfer de máscara. Una ranura sin usar cuesta una comparación, y
una que ni se aplica ni se está previsualizando se salta antes de evaluar su
máscara siquiera.

Cinco decisiones que merecen nombre:

- **Se empaquetan todos, los inertes incluidos**, así que la ranura *i* del shader
  es siempre el selectivo *i* del panel. Una selección se ajusta antes de que
  exista su corrección —es el orden en que trabaja cualquiera—, lo que significa
  que el selectivo que estás mirando en la vista de máscara es justo el que
  descartaría un filtro de «empaqueta solo lo que hace algo».
- La banda de luminancia mide **luminancia, no el valor de HSV**. El valor es solo
  el canal más alto; por esa medida un azul saturado es tan brillante como el
  blanco, y «selecciona lo claro» seleccionaría el cielo.
- Las semimedidas de una ventana son fracciones de la **altura de la imagen, la x
  incluida**. En coordenadas 0..1 planas, un giro deforma la figura en cuanto la
  foto no es cuadrada, y un círculo girado cuarenta y cinco grados sale huevo.
- El contorno dibujado es donde la máscara llega a **cero**; el difuminado dice
  cuánto antes empieza la caída. Un solo contorno lo describe todo, y un anillo
  discontinuo enseña dónde arranca.
- Arrastrar la ventana la mueve **lo que se ha movido el puntero**, no hasta donde
  está el puntero. Agarrar una máscara por el borde y ver cómo se teletransporta
  bajo el cursor es la diferencia entre colocar una y pelearse con una.

El cuentagotas lee la miniatura de los scopes y no el píxel bajo el cursor: esa
miniatura ya ha promediado un pequeño vecindario, y tomar el píxel literal
devuelve el grano que hubiera justo ahí. Lee el color *antes* de que haya corrido
ningún selectivo, porque para lo que sirve es para decirle a una selección con qué
color quedarse.

**Lo que no está** es el refinado espacial de la máscara: desenfocarla, encogerla
o quitarle ruido. El suavizado de cada banda hace el trabajo equivalente en el
espacio del valor, que es para lo que están esos deslizadores, pero una selección
apretada sobre una foto con ruido va a hervir. Hacerlo bien exige calcular la
máscara en una pasada propia para poder desenfocarla, y ese es un cambio que el
pipeline en coma flotante pagaría de todas formas.

### Los scopes

Histograma, forma de onda, parade RGB y vectorscopio, flotando sobre la foto en
vez de guardados en una pestaña: un scope solo sirve mientras estás moviendo
algo, y en cuanto mirarlo cuesta un clic, nadie lo mira.

Leen una miniatura propia —unos doscientos píxeles en el lado largo, por la misma
pasada de color— en lugar de leer de vuelta la vista previa. Leer un búfer de
dibujo a tamaño completo bloquea la GPU en cada fotograma; cuarenta mil muestras
sobran para una distribución y son lo bastante baratas como para rehacerlas
dentro del mismo fotograma que las dibujó.

Para ellos solo corre la pasada de color. Nitidez, reducción de ruido y
desenfoque son espaciales y no significan nada a ese tamaño, y el grano llenaría
la onda de un ruido que no está en la foto a ningún tamaño al que nadie vaya a
verla. Los scopes miden el grade, que es para lo que están.

Dos cosas fáciles de hacer mal:

- Un gráfico nunca se dibuja más ancho de lo que la imagen tiene columnas, ni más
  alto de lo que hay niveles que distinguir. Dibujarlo más grande no añade
  detalle: reparte las mismas medidas entre más celdas y deja huecos, lo que se
  lee como una señal rota y no como una ampliada. Cada gráfico se mide a su propio
  tamaño y se escala al lienzo después.
- El recorte se informa con **dos números, no con dos barras**. Un cielo quemado
  mete en la última casilla píxeles suficientes para aplastar todo el resto del
  histograma contra la base, así que las casillas de los extremos quedan fuera de
  la escala y se dicen en porcentaje debajo.

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

### La gestión de color

Iris trabaja en **Display P3** siempre que el navegador lo permite. P3 contiene
sRGB por completo, así que una foto corriente no pierde nada al procesarse ahí,
mientras que una de un móvil moderno conserva los colores que de verdad tiene.

Lo que estaba roto era más estrecho de lo que parecía. La decodificación ya era
correcta: `createImageBitmap` con `colorSpaceConversion: 'default'` conserva la
gama de origen — es `'none'` quien la pierde, devolviendo valores crudos sin la
etiqueta que decía qué significaban. La pérdida ocurría después, en WebGL: el
búfer de dibujo es sRGB por defecto, así que un rojo P3 puro llegaba a pantalla
como `[233, 52, 36]` en vez de `[255, 0, 0]`. Y cada ajuste se hacía entonces
contra una versión que el archivo nunca contuvo.

Fijar `drawingBufferColorSpace` y `unpackColorSpace` lo arregla. Con ello vienen
dos detalles:

- **Los pesos de luminancia dependen de las primarias.** Todos los controles
  tonales trabajan sobre luminancia, y los de P3 son `(0,229 0,692 0,079)` frente
  a los de sRGB `(0,213 0,715 0,072)`. Ahora son un uniform, no una constante del
  shader.
- **La exportación renderiza en el espacio de trabajo y convierte después**,
  nunca cambiando lo que el pipeline calculó. Vista previa y exportación siguen
  ejecutando la misma matemática; solo difiere la codificación final.

**El espacio de exportación sigue a la foto.** Una imagen con colores que sRGB no
puede contener sale por defecto en Display P3, porque exportarla más estrecha
tiraría algo. Una que cabe entera en sRGB sale en sRGB, porque una etiqueta más
ancha no le aporta nada y solo añade el riesgo de que algún servicio elimine el
perfil y deje los números para ser leídos como lo que no son.

A diferencia del formato o la calidad, esto no es cuestión de gusto que deba
quedarse pegada como preferencia: es una propiedad de lo que hay en el archivo,
así que se recalcula con cada foto. El selector lo fuerza en cualquier dirección,
y el diálogo explica el coste solo cuando eliges estrechar una foto que de verdad
perdería algo. Un aviso que salta en todas es un aviso que nadie lee.

Esa decisión mide el contenido real de los píxeles en vez de fiarse de la
etiqueta ICC, porque muchos archivos etiquetados como P3 caben enteros en sRGB y
no pierden nada al salir.

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

Noventa pruebas que corren en un Chromium headless. No hay pruebas de
interfaz: el riesgo de este proyecto está en los
shaders y en la geometría, y eso no se puede afirmar nada sobre ello en un DOM
simulado. Cada prueba renderiza una imagen conocida por el mismo camino que usa
el botón de exportar y comprueba estadísticas de píxeles.

Las imágenes de prueba se construyen en código con un generador sembrado, no se
guardan como ficheros: un binario en el repositorio es opaco al revisarlo y
acaba desalineado de lo que pretendía demostrar.

Las pruebas se validaron **reintroduciendo los fallos reales** que aparecieron
durante el desarrollo, para comprobar que fallan cuando deben. Cada cosa que
afirman los selectivos —que una ventana gira rígida, que invertir cambia
exactamente lo que antes no cambiaba, que la luminancia no es el valor de HSV, que
la ventana se cruza con la selección de color en vez de sumarse— se comprobó
rompiéndola y viendo caer la prueba correcta, y solo la correcta.

Ese ejercicio
lleva ya cuatro hallazgos: el test del grano no detectaba nada, porque medía
sobre un degradado cuya pendiente enmascaraba el sesgo; uno de los diagnósticos
de este README era falso (ver la nota en «Las pasadas»); y dos de las pruebas del
grade, tal como estaban escritas al principio, no demostraban nada — una componía
una curva consigo misma, donde el orden no puede importar, y la otra medía la
rueda de sombras justo donde el canal ya estaba saturando.

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
| `S` | Mostrar y ocultar los scopes |
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
