// Backend de Plenia — Cloudflare Worker.
//
// Guarda tu API key de Anthropic de forma segura (nunca en el HTML/JS del navegador) y le
// hace de intermediario a dos cosas dentro de Plenia:
//   1. Benito, el chatbot guía (POST a la raíz "/").
//   2. Desarrollo continuo, el facilitador de iniciativas de IA (POST a "/geb-ia/...").
//
// Cómo desplegarlo — ver las instrucciones completas que te dio Claude en el chat. Resumen:
//   1. npm install -g wrangler
//   2. wrangler login
//   3. cd benito-backend
//   4. wrangler secret put ANTHROPIC_API_KEY   (te va a pedir que pegues tu llave, una sola vez)
//   5. wrangler deploy
//   6. Copia la URL que te da ("https://benito-api.<tu-usuario>.workers.dev") y pégala en
//      BENITO_API_URL, dentro de dashboard_onboarding_geb_36.html

// Cambia esto por el dominio real donde vive Plenia en GitHub Pages, para que solo esa página
// pueda usar tu backend (evita que cualquiera se conecte directo a tu Worker y gaste tu saldo).
const ALLOWED_ORIGIN = 'https://universidadgeb-creator.github.io';

const BENITO_SYSTEM_PROMPT = `Eres Benito Delgado, una rana mascota de VIVO 47 (parte de GEB) que ahora ayuda a colaboradores a usar Plenia, el panel interno de RH de la empresa.

Reglas:
- Contesta en español, en tono amigable, cercano y breve (2 a 4 líneas, casi nunca más).
- No uses emojis en tus respuestas, ni ninguno de sobra (Plenia no los usa en ninguna parte del panel).
- Puedes ayudar a navegar Plenia. Secciones que existen: Inicio, Bandeja de entrada, Calendario, Perfil, Tierra fértil (Preonboarding/Encuesta 30 días/Evaluación Inducción/Certificaciones — solo administradores), Benito IA (para cualquier colaborador, ahí un facilitador con IA ayuda a estructurar iniciativas de IA para su equipo), Expediente, Colaboradores (directorio y organigrama), Políticas, Evaluaciones (desempeño), Permisos y Vacaciones, Data (retención de personal — solo administradores), Configuración (solo administradores).
- NUNCA inventes políticas de RH, cifras de sueldo, prestaciones, ni datos personales de nadie. Si no sabes algo con certeza, dilo claramente y sugiere contactar a su líder o al equipo de Capital Humano.
- No tienes acceso a los datos reales del colaborador que te escribe (nombre, sucursal, sueldo, etc.) a menos que la persona te los diga en el mensaje.
- Si te preguntan algo que no tiene que ver con Plenia o con temas de trabajo en GEB, redirige la conversación amablemente.`;

function construirPromptSesionDesarrollo(pw) {
  pw = pw || {};
  return `Eres un facilitador experto en implementación de IA dentro de equipos de trabajo. Estás ayudando a un colaborador o equipo de VIVO 47, a través de "Benito IA" dentro de Plenia, a clarificar una iniciativa de IA para su área y co-construir un plan de acción concreto.

ROL CLARO:
- Eres guía, no desarrollador. No vas a construir nada tú.
- Ayudas a pensar con claridad, revelar supuestos, identificar brechas.
- No uses emojis en tus respuestas.

PRE-TRABAJO DEL EQUIPO:
Iniciativa: ${pw.initiativeName || 'Sin nombre'}
Equipo: ${pw.teamName || '—'} / ${pw.area || '—'} | Contacto: ${pw.contact || '—'}
Qué quieren lograr: ${pw.description || 'No completado'}
Qué esperan de la IA: ${pw.aiExpectation || 'No completado'}
Situación actual: ${pw.currentSituation || 'No completado'}
Lo que ya exploraron: ${pw.explored || 'No completado'}
Sus preguntas para la sesión: ${pw.questions || 'No completado'}

CÓMO FACILITAR:
1. Al iniciar: saluda brevemente, resume en 1-2 frases lo que entendiste y haz LA pregunta más importante que faltó.
2. UNA pregunta a la vez, siempre.
3. Si hablan de soluciones antes de tiempo, pregunta: "¿Qué pasa hoy sin eso?".
4. Busca concreción en: claridad del problema, datos disponibles, involucramiento de usuarios, sponsor con poder real.
5. Cuando tengas suficiente contexto di: "Creo que tenemos suficiente para armar el plan. ¿Lo generamos?"
6. Nunca inventes datos, cifras o compromisos de la empresa que no te haya dado el equipo.

TONO: Directo, cálido, conversacional. Respuestas cortas. Español siempre.`;
}

function construirPromptPlanDesarrollo(pw, mensajes) {
  pw = pw || {};
  const historial = (mensajes || []).map(m => `${m.role === 'user' ? 'Equipo' : 'Facilitador'}: ${m.content}`).join('\n\n');
  return `Basándote en el pre-trabajo y la sesión de facilitación, genera un plan de acción estructurado para esta iniciativa de IA.

PRE-TRABAJO:
Iniciativa: ${pw.initiativeName || 'Sin nombre'} | Equipo: ${pw.teamName || '—'} / ${pw.area || '—'}
Qué quieren: ${pw.description || '—'}
Qué esperan que haga la IA: ${pw.aiExpectation || '—'}
Situación actual: ${pw.currentSituation || '—'}
Explorado: ${pw.explored || '—'}

SESIÓN:
${historial}

Responde ÚNICAMENTE con JSON válido, sin markdown ni texto extra, sin emojis en ningún campo de texto:
{"tipo_proyecto":"chatbot|docs|analytics|automation|content|search|other","resumen":"2-3 frases","nivel_madurez":"listo|prometedor|desarrollo|no_maduro","evaluacion":{"problema":0,"datos":0,"usuarios":0,"gobierno":0},"buenas_practicas":["práctica 1","práctica 2","práctica 3","práctica 4","práctica 5"],"pasos":[{"texto":"acción","dueno":"quién","fecha":"plazo"}],"herramientas":"herramientas específicas","siguiente_contacto":"cuándo y para qué"}`;
}

function construirPromptDetalleDesarrollo(body) {
  const step = (body && body.step) || {};
  if (!step.texto) return null;
  return `Contexto: iniciativa de IA llamada "${body.initiativeName || 'sin nombre'}" del equipo "${body.teamName || '—'}".

Diagnóstico: ${body.resumen || ''}

Paso de acción a detallar:
"${step.texto}"
Dueño: ${step.dueno || 'por definir'} | Fecha: ${step.fecha || 'por definir'}

Dame un paso a paso detallado y práctico (4 a 7 pasos concretos) para lograr este punto específico. Incluye:
- Acciones concretas en orden
- A quién involucrar y cómo
- Qué entregable se produce al final
- Un posible obstáculo y cómo manejarlo

Sé breve, directo, accionable, sin emojis. En español.`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'Falta configurar ANTHROPIC_API_KEY en el Worker.' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'JSON inválido.' }, 400);
    }

    const path = new URL(request.url).pathname;

    if (path === '/geb-ia/session') {
      const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
      if (!messages.length) return jsonResponse({ error: 'Falta el mensaje.' }, 400);
      return llamarClaude({ env, system: construirPromptSesionDesarrollo(body.preTrabajo), messages, maxTokens: 500 });
    }

    if (path === '/geb-ia/plan') {
      const prompt = construirPromptPlanDesarrollo(body.preTrabajo, body.messages);
      return llamarClaude({ env, messages: [{ role: 'user', content: prompt }], maxTokens: 3000 });
    }

    if (path === '/geb-ia/detail') {
      const prompt = construirPromptDetalleDesarrollo(body);
      if (!prompt) return jsonResponse({ error: 'Falta información del paso.' }, 400);
      return llamarClaude({ env, messages: [{ role: 'user', content: prompt }], maxTokens: 700 });
    }

    // Por defecto: Benito.
    const messages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    if (!messages.length) return jsonResponse({ error: 'Falta el mensaje.' }, 400);
    return llamarClaude({ env, system: BENITO_SYSTEM_PROMPT, messages, maxTokens: 300 });
  },
};

async function llamarClaude({ env, system, messages, maxTokens }) {
  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages,
      }),
    });
  } catch (e) {
    return jsonResponse({ error: 'No se pudo conectar con Anthropic.' }, 502);
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text();
    return jsonResponse({ error: 'Anthropic devolvió un error.', detail }, 502);
  }

  const data = await anthropicRes.json();
  // No asumir que el texto está en content[0]: si Claude usó razonamiento extendido antes
  // de responder, ese primer bloque es de tipo "thinking" (sin .text) y la respuesta real
  // queda en un bloque posterior — hay que buscar el primer bloque de tipo "text".
  const bloqueTexto = Array.isArray(data.content) ? data.content.find(b => b.type === 'text') : null;
  const texto = bloqueTexto && bloqueTexto.text
    ? bloqueTexto.text
    : 'No pude pensar en una respuesta, intenta de nuevo.';
  return jsonResponse({ texto });
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: corsHeaders() });
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };
}
