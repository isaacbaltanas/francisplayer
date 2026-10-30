# Francis Player — Roadmap

## 0.3.0 — Automatización agrupada

- Inicio maximizado en macOS y Windows.
- Línea de tiempo visible en al menos el 40 % de la ventana.
- Configuración organizada por pestañas.
- Un único título localizado para cada sección.
- Automatización global visible y ocultable.
- Visualización de niveles en porcentaje o decibelios.
- Grupos independientes para Ducking Alto, Ducking Bajo, Transición Entrada y Transición Salida.
- Edición vinculada por defecto, con iluminación de todos los segmentos afectados.
- `Shift` para separar y editar solamente un segmento.
- Menú contextual para crear grupos o reasignar un segmento a un grupo existente.
- Los grupos de automatización controlan la reproducción real.

## 0.4.0 — Edición manual e imán

- Arrastre manual y desde las bibliotecas.
- Imán inteligente, de cuadrícula, bordes o posición original.
- Bloqueo/reutilización, contador de apariciones y destacado de cortes.

## 0.5.0 — Bibliotecas, pestañas y pistas

- Varias pestañas dentro de Música y Locuciones.
- Una pista de línea de tiempo por pestaña.
- Ducking global por tipo: música y voz.
- Automatización local opcional por pista.
- Creación, renombrado, orden y eliminación de pestañas.

## 0.6.0 — Regiones de audio y solapamientos

- Onda de audio en cada región.
- Fade in/out local arrastrando las esquinas superiores.
- Regiones superpuestas semitransparentes y reproducción simultánea.
- Detección y aviso de voces solapadas.

## 0.7.0 — Proyectos portátiles

- Contenedor `.francis` asociado a la aplicación y abrible con doble clic.
- Estructura interna legible: `Music/`, `Voice/`, `Configuration/` y manifiesto.
- Guardar, Guardar como, abrir y transferir proyectos entre macOS y Windows.

## 0.8.0 — Exportación local

- Exportación local con FFmpeg.
- WAV, MP3, AAC, FLAC y otros formatos compatibles.
- Mono/estéreo, frecuencia de muestreo, profundidad de bits, bitrate y opciones específicas por formato.
