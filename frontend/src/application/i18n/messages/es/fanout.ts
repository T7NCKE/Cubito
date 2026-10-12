import type { enFanout } from '../en/fanout'

export const esFanout: Record<keyof typeof enFanout, string> = {
  'fanout.title': 'fan-out · {parent}',
  'fanout.titleBare': 'fan-out',
  'fanout.callout': 'fan-out · {count} × {agent}',
  'fanout.submit': 'lanzar camada',
  'fanout.dismiss': 'cerrar',
  'fanout.cancel': 'cancelar',
  'fanout.counters':
    '{working} trabajando · {waiting} esperando · {spawning} naciendo · {ready} · {gates} · {questions}',
  'fanout.ready.one': '{count} listo',
  'fanout.ready.other': '{count} listos',
  'fanout.gates.one': '{count} compuerta',
  'fanout.gates.other': '{count} compuertas',
  'fanout.questions.one': '{count} pregunta',
  'fanout.questions.other': '{count} preguntas',
  'fanout.countersFailedTail.one': '{count} error',
  'fanout.countersFailedTail.other': '{count} errores',
  'fanout.countRange': 'la camada tiene entre {min} y {max} cubos',
  'fanout.promptRequired': 'escribí qué tiene que hacer la camada',
  'fanout.repoUnresolved': 'repositorio aún no resuelto',
  'fanout.childFailureFallback': 'no se pudo crear el cubo',
  'fanout.gateResolve': 'resolver',
  'fanout.questionAnswer': 'responder'
}
