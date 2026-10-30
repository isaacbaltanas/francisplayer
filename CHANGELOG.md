# Changelog

Los cambios relevantes de Francis Player se documentan en este archivo. El proyecto utiliza Semantic Versioning.

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
