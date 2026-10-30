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

Consulta [el roadmap](docs/ROADMAP.md) para las siguientes versiones.
