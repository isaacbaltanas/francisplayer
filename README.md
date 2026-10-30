# Francis Player

Aplicación de escritorio para montar automáticamente programas de música y locuciones.

## Desarrollo

Requiere Node.js. Instala las dependencias y abre la aplicación:

```bash
npm install
npm run dev
```

Pruebas y compilación:

```bash
npm test
npm run build
npm run package:mac
```

La versión moderna está orientada a macOS y Windows 10/11. Una futura compilación heredada con Electron 22 podrá cubrir Windows 8.1, sin garantías de seguridad del navegador integrado.

## Versionado

Francis Player sigue [Semantic Versioning](https://semver.org/):

- `PATCH` para correcciones compatibles, por ejemplo `0.1.0` → `0.1.1`.
- `MINOR` para nuevas funciones compatibles, por ejemplo `0.1.0` → `0.2.0`.
- `MAJOR` para cambios incompatibles una vez alcanzada la versión estable `1.0.0`.

Toda mejora debe actualizar la versión de `package.json` y añadir una entrada a `CHANGELOG.md`.

## Versión 0.1

- Importación local de canciones y locuciones.
- Lectura de duración y preescucha individual.
- Orden secuencial o aleatorio determinista.
- Repetición opcional de música.
- Duración objetivo.
- Locuciones por intervalo o distribución uniforme.
- Prevención opcional de solapamientos.
- Línea de tiempo visual de dos pistas.
- Regiones explícitas de música ausente.
- Interfaz en español e inglés.

## Versión 0.2

- Reproducción de la línea de tiempo completa.
- PLAY, PAUSE, STOP, búsqueda y cabezal sincronizado.
- Niveles de música y voz configurables en dB.
- Ducking con tiempos de bajada y recuperación.
- Indicador de ganancia musical en tiempo real.

## Versión 0.3

- Aplicación maximizada al iniciar.
- Línea de tiempo con al menos el 40 % de la ventana.
- Configuración compacta mediante pestañas.
- Editor de automatización agrupada con porcentajes o decibelios.
- Ducking Alto, Ducking Bajo y transiciones de entrada/salida vinculables.
- `Shift` para separar un segmento y menú contextual para reasignar grupos.
- Automatizaciones visibles u ocultables y conectadas a la reproducción.

## Versión 0.4

- Cortes movibles manualmente y archivos arrastrables desde las bibliotecas.
- Imán inteligente configurable, guía de ajuste y posición automática recuperable.
- Bloqueo o reutilización de archivos ya insertados.
- Contador de apariciones y destacado múltiple de cortes en la línea de tiempo.
- Recalculo automático de los huecos de música tras cada edición.

## Versión 0.5

- Varias pestañas de música y voz, cada una convertida en su propia pista.
- Creación, nombre, orden, eliminación y automatización local por pestaña.
- Inserción de una lista, todas en orden, alternadas, aleatorias o mediante un patrón personalizado.

## Versión 0.6

- Regiones con forma de onda, fades locales desde las esquinas y mezcla simultánea.
- Transparencia y aviso de locuciones solapadas.
- Automatización local con puntos e interpolación por cada pista.

## Versión 0.7

- Guardar y abrir proyectos portátiles `.francis`, también por doble clic.
- Contenedor único con audio organizado en `Music/` y `Voice/` por pestañas.
- Configuración, montaje y automatizaciones en JSON legible dentro de `Configuration/`.
- Recuperación completa en otro equipo sin referencias a los archivos originales.

## Versión 0.8

- Exportación local integrada con FFmpeg, sin nube ni servicios de pago.
- WAV, MP3, AAC/M4A, FLAC, OGG y Opus.
- Mono/estéreo, frecuencia, profundidad, bitrate, compresión FLAC y normalización LUFS.
- Render completo de mezcla, ducking, fades, automatizaciones y solapamientos.

Los avisos y licencias del binario FFmpeg incluido se documentan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Versión 0.9

- Importación masiva de archivos y carpetas completas, con progreso y análisis concurrente controlado.
- Nombres automáticos de pestaña basados en la carpeta y el nombre más común.
- Integridad opcional, SHA-256 y deduplicación exacta.
- Cuarentena con preescucha y admisión manual: ningún archivo se pierde ni se ignora silenciosamente.
- Historial persistente con el resultado individual de cada archivo.

## Versión 0.10

- LUFS, True Peak, RMS y ganancia recomendada para cada archivo.
- Normalización no destructiva con objetivo y techo True Peak configurables.
- Vúmetro de mezcla con LUFS momentáneos, cortos e integrados.
- Motor Web Audio con eco y reverberación escuchables en tiempo real.
- Render equivalente de normalización y efectos durante la exportación.

## Versión 0.11

- Preescucha directa y claramente visible en cada archivo de las listas.
- Relleno musical por repetición o selección aleatoria, con fade out final automático.
- Duración calculada a partir de las locuciones e intervalo máximo configurable de 300 segundos.
- Sliders enlazados que redistribuyen el montaje en tiempo real.
- Las locuciones movidas manualmente quedan ancladas hasta que el usuario restaura su posición automática.

## Versión 0.12

- Icono oficial coherente en la interfaz, ejecutables, ventanas, Dock, Alt-Tab y barra de tareas.
- Recursos nativos ICNS para macOS e ICO para Windows derivados de una única marca SVG.
- Identidad y metadatos de aplicación estables en ambos sistemas.

Consulta [el roadmap](docs/ROADMAP.md) para las siguientes versiones.
