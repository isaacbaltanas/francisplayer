import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  es: { translation: {
    appSubtitle: 'Estudio de montaje automático',
    newProject: 'Proyecto sin título',
    projectReady: 'Proyecto listo para montar',
    library: 'Biblioteca', music: 'Música', voices: 'Locuciones',
    addMusic: 'Añadir música', addVoice: 'Añadir locuciones',
    dropHint: 'MP3, WAV, M4A, AAC o FLAC', emptyMusic: 'Añade canciones para comenzar',
    emptyVoice: 'Añade locuciones para distribuirlas', remove: 'Eliminar', play: 'Escuchar', pause: 'Pausar',
    items: '{{count}} archivos', total: '{{duration}} en total',
    setup: 'Configuración de montaje', targetDuration: 'Duración objetivo', minutes: 'minutos',
    musicOrder: 'Orden de música', voiceOrder: 'Orden de locuciones', sequential: 'Secuencial', random: 'Aleatorio',
    repeatMusic: 'Repetir música al terminar', voicePlacement: 'Distribución de locuciones',
    interval: 'Intervalo fijo', uniform: 'Uniforme', intervalSeconds: 'Intervalo entre inicios', seconds: 'segundos',
    allowOverlap: 'Permitir solapamientos', seed: 'Semilla aleatoria',
    mount: 'MONTAR PROGRAMA', remount: 'VOLVER A MONTAR',
    timeline: 'Línea de tiempo', timelineEmpty: 'Importa audio y pulsa MONTAR PROGRAMA',
    zoom: 'Zoom', voiceTrack: 'LOCUCIONES', musicTrack: 'MÚSICA', missingMusic: 'FALTA MÚSICA',
    summary: '{{music}} clips de música · {{voice}} locuciones · {{duration}}',
    warningMissingMusic: 'La música no cubre toda la duración. El área roja será silencio.',
    warningVoiceOutside: 'Algunas locuciones no caben completas dentro de la duración objetivo.',
    fileError: 'No se pudo leer uno o varios archivos de audio.',
    language: 'Idioma', spanish: 'ES', english: 'EN', statusDraft: 'BORRADOR', duration: 'Duración'
  } },
  en: { translation: {
    appSubtitle: 'Automatic arrangement studio',
    newProject: 'Untitled project',
    projectReady: 'Project ready to arrange',
    library: 'Library', music: 'Music', voices: 'Voice spots',
    addMusic: 'Add music', addVoice: 'Add voice spots',
    dropHint: 'MP3, WAV, M4A, AAC or FLAC', emptyMusic: 'Add songs to get started',
    emptyVoice: 'Add voice spots to distribute them', remove: 'Remove', play: 'Preview', pause: 'Pause',
    items: '{{count}} files', total: '{{duration}} total',
    setup: 'Arrangement settings', targetDuration: 'Target duration', minutes: 'minutes',
    musicOrder: 'Music order', voiceOrder: 'Voice order', sequential: 'Sequential', random: 'Random',
    repeatMusic: 'Repeat music when it ends', voicePlacement: 'Voice distribution',
    interval: 'Fixed interval', uniform: 'Evenly spaced', intervalSeconds: 'Interval between starts', seconds: 'seconds',
    allowOverlap: 'Allow overlaps', seed: 'Random seed',
    mount: 'BUILD PROGRAM', remount: 'BUILD AGAIN',
    timeline: 'Timeline', timelineEmpty: 'Import audio and press BUILD PROGRAM',
    zoom: 'Zoom', voiceTrack: 'VOICE', musicTrack: 'MUSIC', missingMusic: 'MUSIC MISSING',
    summary: '{{music}} music clips · {{voice}} voice spots · {{duration}}',
    warningMissingMusic: 'Music does not cover the full duration. The red area will be silence.',
    warningVoiceOutside: 'Some voice spots do not fit completely inside the target duration.',
    fileError: 'One or more audio files could not be read.',
    language: 'Language', spanish: 'ES', english: 'EN', statusDraft: 'DRAFT', duration: 'Duration'
  } }
};

void i18n.use(initReactI18next).init({
  resources,
  lng: 'es',
  fallbackLng: 'es',
  interpolation: { escapeValue: false }
});

export default i18n;
