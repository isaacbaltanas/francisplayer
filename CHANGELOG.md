# Changelog

Los cambios relevantes de Francis Player se documentan en este archivo. El proyecto utiliza Semantic Versioning.

## [0.14.3] - 2026-10-31

### Corregido

- Play cambia inmediatamente a Stop, incluso mientras se prepara una preescucha convertida.
- Stop cancela tanto el audio activo como cualquier reproducción o conversión que todavía estuviera pendiente.
- Los clics rápidos Play–Stop–Play y los cambios entre canciones no pueden dejar reproductores duplicados o sin control.
- La reproducción de la línea de tiempo invalida las cargas antiguas al pausar, detener, buscar o volver a reproducir.
- Montar, abrir o crear un proyecto detiene también cualquier preescucha pendiente.

### Cambiado

- La transición visual entre Play y Stop es más inmediata y suave.

## [0.14.2] - 2026-10-31

### Añadido

- Conversión automática y en caché a MP3 para preescuchar AIFF y otros formatos que Chromium no decodifica de forma nativa.
- AIFF, WMA, OGA y Opus aparecen también en el selector manual de archivos admitidos.

### Cambiado

- Los avisos utilizan una notificación compacta abajo a la derecha, con el mismo tamaño, posición y estilo base que «Analizando archivos…».
- Las notificaciones de aviso pueden cerrarse manualmente y desaparecen automáticamente después de ocho segundos.

### Corregido

- La preescucha ya no indica que un AIFF disponible ha desaparecido cuando el problema real era la compatibilidad del decodificador.
- La conversión temporal funciona igualmente en archivos recién importados y en proyectos `.francis` recuperados.

## [0.14.1] - 2026-10-31

### Añadido

- Zoom continuo de la línea de tiempo mediante el gesto de pellizcar en trackpads de macOS y Windows.
- Ayuda contextual en el control de zoom para descubrir el gesto.

### Cambiado

- El zoom gestual mantiene bajo el cursor el mismo punto temporal y permite navegar entre 50 % y 400 %.
- El desplazamiento con dos dedos queda contenido dentro de la línea de tiempo y no desplaza accidentalmente la ventana.

## [0.14.0] - 2026-10-31

### Añadido

- Botón visible «Añadir todo a pista» en las bibliotecas de música y locuciones.
- Protocolo multimedia interno compatible con desarrollo y aplicación empaquetada para la preescucha de archivos locales.
- Mensaje claro cuando un archivo ya no está disponible o no se puede reproducir.

### Cambiado

- El botón de carpeta muestra ahora su función mediante texto y mantiene la ayuda contextual.
- El piloto verde pasa a ser un indicador no pulsable y se activa automáticamente cuando el archivo está presente en la línea de tiempo.

### Corregido

- Las listas largas quedan confinadas dentro de su panel y disponen de desplazamiento propio.
- Los controles de la fila superior ya no se superponen sobre la cabecera de la línea de tiempo.
- Los botones de preescucha ya no inician accidentalmente el arrastre de la fila.

## [0.13.2] - 2026-10-31

### Corregido

- El tramo musical alto situado después de la locución admite arrastre vertical, igual que el tramo anterior.
- El punto verde conserva el arrastre horizontal para editar la recuperación mientras la línea ajusta el nivel musical.

## [0.13.1] - 2026-10-31

### Corregido

- La pista del editor gráfico es más alta y contiene por completo automatizaciones, puntos y etiquetas.
- Los puntos mantienen forma circular independientemente del tamaño de la ventana.
- Los puntos superiores se desplazan libremente en dos dimensiones: horizontalmente editan bajada/recuperación y verticalmente el nivel musical.
- Los puntos de nivel se desplazan verticalmente para editar música, voz y ducking.
- El cálculo del arrastre respeta la escala real del SVG incluso cuando cambia el tamaño del panel.

## [0.13.0] - 2026-10-31

### Añadido

- Selector Valores/Gráfico dentro de «Mezcla y ducking».
- Editor gráfico con pista musical, clip de locución, onda, segmentos, puntos y etiquetas de dB y milisegundos.
- Edición mediante arrastre del nivel musical, nivel de voz, nivel de ducking y duraciones de bajada y recuperación.
- El modo de edición elegido se guarda dentro del proyecto.
- Menú nativo «Archivo» en macOS y Windows con Nuevo, Abrir, Guardar, Guardar como, Exportar y Salir/Cerrar.
- Atajos nativos para todas las operaciones principales del proyecto.

### Cambiado

- El editor gráfico reutiliza los mismos colores y parámetros que las automatizaciones reales de la línea de tiempo.
- Los ajustes gráficos y numéricos permanecen completamente sincronizados.

## [0.12.1] - 2026-10-31

### Corregido

- «Mostrar niveles como» y «Mostrar automatizaciones» funcionan también antes de montar el programa.
- Las dos preferencias se guardan en el proyecto y se aplican al crear o volver a crear la automatización.
- Los proyectos anteriores reciben los valores predeterminados compatibles al abrirse.

## [0.12.0] - 2026-10-31

### Añadido

- Identidad visual oficial de Francis Player en SVG, PNG, ICNS e ICO.
- Icono propio en el paquete macOS, Dock, selector de aplicaciones y panel Acerca de.
- Icono y metadatos preparados para el ejecutable, ventanas, Alt-Tab y barra de tareas de Windows.
- Identificador estable de aplicación para que Windows agrupe correctamente sus ventanas.

### Cambiado

- La interfaz utiliza el mismo recurso maestro que los iconos del sistema para mantener la marca consistente.

## [0.11.2] - 2026-10-31

### Corregido

- Los sliders y campos de duración avanzan únicamente por minutos enteros.
- El intervalo entre locuciones avanza únicamente por segundos enteros, sin valores con coma.

## [0.11.1] - 2026-10-31

### Corregido

- Los controles nativos del campo numérico ya no ocultan el valor del intervalo.
- El subtítulo identifica la aplicación como estudio de montaje automático para megafonías.

## [0.11.0] - 2026-10-31

### Añadido

- Botón de preescucha más visible en cada archivo de música y locución.
- Tres políticas cuando la música no cubre el programa: dejar silencio, repetir la lista o rellenar aleatoriamente.
- Fade out local automático de cinco segundos en la última canción cuando debe recortarse para terminar exactamente con el programa.
- Modo en el que la cantidad, duración e intervalo de las locuciones dictan la duración total.
- Sliders enlazados para duración total e intervalo entre locuciones, de 0 a 300 segundos.
- Redistribución de las locuciones y reconstrucción musical en tiempo real al modificar los controles.
- Anclaje visible para las locuciones colocadas manualmente.

### Comportamiento

- Las locuciones ancladas conservan su posición absoluta al redistribuir; las demás se recolocan automáticamente.
- Si el nuevo final deja un anclaje fuera del programa, se desplaza al último inicio válido.
- El menú contextual permite devolver cualquier anclaje a su posición automática.
- Los proyectos anteriores se abren con la política de relleno equivalente a su antigua opción de repetición.

## [0.10.0] - 2026-10-31

### Añadido

- Análisis EBU R128 individual durante la importación mediante FFmpeg.
- Metadata por archivo con LUFS integrados, Loudness Range, True Peak, pico de muestra, RMS y corrección recomendada.
- Visualización desconectable de LUFS, dBTP y ganancia junto a cada archivo.
- Normalización no destructiva con objetivo configurable y limitación automática por True Peak.
- Objetivo inicial de −23 LUFS y techo de −1 dBTP, ambos editables.
- Nuevo grafo de reproducción Web Audio a 48 kHz para toda la mezcla.
- Vúmetro en tiempo real con LUFS momentáneos, Short-Term e integrados, además de pico.
- Procesador AudioWorklet separado de la interfaz con ponderación K y gating EBU.
- Eco en tiempo real con retardo, feedback y mezcla wet/dry.
- Reverberación por convolución en tiempo real con duración, caída y mezcla configurables.
- Aplicación de normalización, eco y reverberación en las exportaciones FFmpeg.
- Pruebas de análisis R128, límites True Peak, normalización y cadena de efectos.

### Cambiado

- La reproducción deja de depender del volumen directo de múltiples elementos y se enruta por nodos de ganancia, efectos y medición.
- Los proyectos antiguos reciben valores compatibles al abrirse aunque no tengan todavía análisis de sonoridad.

## [0.9.0] - 2026-10-31

### Añadido

- Arrastre de archivos y carpetas completas sobre las bibliotecas.
- Importación preparada para lotes de 1000 archivos mediante una cola de cuatro analizadores y renderizado diferido de filas.
- Enumeración recursiva de subcarpetas y botón específico para seleccionar carpetas.
- Deducción automática del nombre de pestaña a partir de la carpeta y de las palabras más frecuentes en los archivos.
- Hash SHA-256 de cada archivo para evitar duplicados exactos, incluso si cambian de ubicación o nombre.
- Comprobación opcional de integridad mediante decodificación completa con FFmpeg.
- Cuarentena persistente para formatos no reconocidos, archivos dañados, ilegibles o sin duración válida.
- Preescucha individual y admisión manual desde cuarentena, con advertencia visible posterior.
- Registro por archivo de importados, duplicados y enviados a cuarentena.
- Progreso incremental durante el análisis masivo.
- Inclusión física de los archivos en cuarentena dentro de `Quarantine/` al guardar un proyecto `.francis`.
- Pruebas automáticas del nombre común y de la recuperación portátil de archivos en cuarentena.

### Seguridad de datos

- Ningún archivo dudoso se elimina ni se descarta silenciosamente.
- Una segunda importación incorpora únicamente archivos que todavía no existen en la biblioteca o la cuarentena.

## [0.8.0] - 2026-10-31

### Añadido

- Exportación completamente local mediante un binario FFmpeg incluido en la aplicación.
- Formatos WAV, MP3, AAC/M4A, FLAC, OGG Vorbis y Opus.
- Selección mono/estéreo y frecuencias de 44,1, 48 y 96 kHz.
- Profundidades de 16, 24 y 32 bits para formatos sin pérdida.
- Bitrates de 96 a 320 kbps para formatos con pérdida.
- Nivel de compresión específico para FLAC.
- Normalización opcional a −14 LUFS.
- Ventana de exportación con resumen, progreso, cancelación, resultado y errores.
- Render de todas las pistas, posiciones, superposiciones, fades, automatización local y ducking agrupado.
- Script de filtros independiente para soportar proyectos grandes sin superar el límite de comandos de Windows.
- Pruebas del plan de mezcla, códecs y lectura de progreso, además de una exportación WAV real de extremo a extremo.

### Seguridad y portabilidad

- FFmpeg se ejecuta sin shell y recibe rutas como argumentos independientes.
- El binario se desempaqueta correctamente desde ASAR y se selecciona de forma nativa en macOS o Windows.

## [0.7.0] - 2026-10-30

### Añadido

- Proyectos portátiles en un único contenedor ZIP con extensión `.francis`.
- Carpetas humanas `Music/`, `Voice/` y `Configuration/`, con una subcarpeta por pestaña.
- Manifiesto de proyecto, montaje, automatizaciones y ajustes en JSON legible.
- Acciones Nuevo, Abrir, Guardar y Guardar como en la barra superior.
- Atajos `Ctrl/⌘+O`, `Ctrl/⌘+S` y `Ctrl/⌘+Shift+S`.
- Recuperación de archivos, pestañas, pistas, formas de onda, fades, automatizaciones y preferencias.
- Manejo de proyectos abiertos por doble clic tanto mediante eventos de macOS como por argumento en Windows.
- Declaración de asociación documental `.francis` en el paquete de macOS.
- Validación de formato y protección frente a rutas inseguras dentro del contenedor.
- Prueba automática de escritura, estructura interna y recuperación completa del archivo.

## [0.6.0] - 2026-10-30

### Añadido

- Forma de onda extraída del audio y dibujada dentro de cada región de la línea de tiempo.
- Tiradores en las esquinas superiores para crear `fade in` y `fade out` locales al estilo Logic.
- Curvas visibles de fade y aplicación real de su ganancia durante la reproducción.
- Reproducción simultánea de todas las regiones de música y voz que coinciden temporalmente.
- Transparencia y contorno de advertencia en regiones solapadas.
- Detección específica y aviso localizado cuando se solapan locuciones.
- Automatización local convencional por pista, con puntos añadibles por doble clic, movibles y eliminables con botón derecho.
- Interpolación de automatización local conectada al motor de audio.
- Pruebas de fades, interpolación y detección de solapamientos.

## [0.5.0] - 2026-10-30

### Añadido

- Varias pestañas independientes dentro de las bibliotecas de música y locuciones.
- Creación, renombrado por doble clic, reordenación y eliminación de pestañas.
- Una pista diferenciada y coloreada en la línea de tiempo por cada pestaña.
- Activación individual de automatización local por pista.
- Lógicas de inserción para la pestaña activa, todas las pestañas en orden, alternancia, aleatorio global y patrón personalizado.
- Patrones humanos como `1, 2, 1, 3`, consumiendo todas las colas sin perder archivos.
- Pruebas automáticas del analizador de patrones y de las secuencias entre listas.

### Cambiado

- Cada archivo y cada corte conservan la pestaña/pista de procedencia durante el montaje y la edición manual.
- Los contadores y totales de biblioteca se calculan por la pestaña visible.

## [0.4.0] - 2026-10-30

### Añadido

- Arrastre horizontal manual de cualquier corte de música o voz en la línea de tiempo.
- Arrastre directo desde las bibliotecas hasta una posición concreta de la línea de tiempo.
- Imán configurable con ajuste inteligente, a cuadrícula, a bordes o a la posición generada original.
- Guía fluorescente y lectura temporal durante el ajuste magnético.
- `Control` para omitir temporalmente el imán durante un arrastre.
- Menú contextual para restaurar la posición automática o retirar un corte del montaje.
- Indicador de uso y contador de apariciones junto a cada archivo de las bibliotecas.
- Preferencia para bloquear archivos ya utilizados o permitir reutilizarlos varias veces.
- Selección de uno o varios archivos para destacar todas sus apariciones y atenuar el resto del montaje.
- Pruebas automáticas de ajuste magnético, bordes, cuadrícula y límites.

### Cambiado

- Los huecos de música se recalculan al mover, añadir o retirar cortes manualmente.
- Cada corte conserva su posición generada para poder regresar a ella posteriormente.

## [0.3.0] - 2026-10-30

### Añadido

- Inicio maximizado tanto en macOS como en Windows.
- Editor visual de automatización global de música con nodos y líneas editables.
- Visualización de automatización en porcentaje o decibelios.
- Grupos vinculados para Ducking Alto, Ducking Bajo, Transición Entrada y Transición Salida.
- Edición conjunta de todos los segmentos pertenecientes al mismo grupo.
- Iluminación fluorescente de los segmentos que se modificarán en conjunto.
- `Shift` para separar un segmento y crear automáticamente un grupo nuevo.
- Menú contextual para desvincular o reasignar segmentos a grupos existentes.
- Automatizaciones agrupadas conectadas al motor de reproducción real.
- Posibilidad de mostrar u ocultar la pista de automatización.
- Configuración organizada en pestañas de Montaje, Audio y Automatización.
- Roadmap técnico para pistas por pestaña, proyectos `.francis` y exportación.

### Cambiado

- La línea de tiempo ocupa como mínimo el 40 % de la ventana.
- Las bibliotecas y la configuración se adaptan al espacio superior restante.
- Los encabezados de sección muestran un único título en el idioma seleccionado.

## [0.2.0] - 2026-10-30

### Añadido

- Reproducción completa del montaje desde la línea de tiempo.
- Controles de reproducción, pausa, parada y búsqueda temporal.
- Cabezal de reproducción sincronizado y contador con milisegundos.
- Niveles independientes para música y locuciones.
- Ducking configurable en dB durante las locuciones.
- Tiempos independientes de bajada y recuperación de la música.
- Indicador en tiempo real de la ganancia musical.
- Reproducción simultánea de locuciones cuando se permiten solapamientos.
- Pruebas automáticas para la automatización de ganancia y conversión de decibelios.

## [0.1.0] - 2026-10-30

### Añadido

- Aplicación de escritorio con Electron, React y TypeScript.
- Importación local y preescucha de canciones y locuciones.
- Lectura automática de duración y tamaño de los audios.
- Montaje secuencial o aleatorio mediante semilla reproducible.
- Repetición opcional de música y ajuste exacto a una duración objetivo.
- Distribución de locuciones por intervalo o de manera uniforme.
- Control de solapamientos de locuciones.
- Línea de tiempo proporcional con dos pistas, zoom y regiones de música ausente.
- Interfaz completa en español e inglés.
- Empaquetado local para macOS.
- Pruebas automáticas del motor de montaje.
