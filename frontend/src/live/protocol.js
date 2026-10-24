// Wire contract for apps/api/frontrow. Times are session-relative seconds;
// transcript duration is seconds, and seq increases for the entire session.

/** @typedef {string|number|null} MessageId */
/** @typedef {{index:number,text:string}} Slide */
/** @typedef {{id:string,persona:string}} ListenerInfo */
/** @typedef {'idle'|'presenting'|'qa'|'reporting'|'ended'} SessionPhase */
/** @typedef {{id:string,state:SessionPhase,preset:string,current_slide:number|null,listeners:ListenerInfo[],slides:Slide[]}} SessionInfo */
/** @typedef {{preset?:string,slides?:Slide[],tick_interval_seconds?:number}} CreateSessionRequest */
/** @typedef {{token:string,provider:string,expires_in_seconds?:number|null,model_id?:string,vad_silence_threshold_secs?:number,include_timestamps?:boolean}} SttToken */
/** @typedef {{type:'start',id?:MessageId}|{type:'transcript',id?:MessageId,seq:number,text:string,duration?:number}|{type:'slide',id?:MessageId,index:number}|{type:'take_question'|'playback_started'|'playback_ended'|'answer_done',id?:MessageId,question_id:string}|{type:'end_presenting'|'next_question'|'end_qa'|'finish'|'ping',id?:MessageId}} ClientRequest */
/** @typedef {{type:'ack',id:MessageId,request:string,result:Record<string,any>}} AckEnvelope */
/** @typedef {{type:'error',id?:MessageId,request?:string|null,message:string,detail?:object[]|null}} ErrorEnvelope */
/** @typedef {{question_id:string,listener:string,persona:string,question:string,quote:string,source:string,follow_up_of?:string|null,tick?:number}} HandData */
/** @typedef {{tick:number,listener:string,persona:string,slide:number|null,attention:number,confusion:number,understood:string,has_question:boolean}} ReactionData */
/** @typedef {{attention:number|null,confusion:number|null,comprehension:number|null}} RoomGauge */
/**
 * Every backend event from docs/backend-interface.md §6.
 * @typedef {Object} EventData
 * @property {{state:SessionPhase}} state
 * @property {{slide:number|null}} slide_change
 * @property {{seq:number,start:number,end:number,text:string,answer_to:string|null}} transcript
 * @property {{seq:number,text:string,reason:'agent_speaking'}} transcript_dropped
 * @property {{tick:number,slide:number|null}} tick_start
 * @property {ReactionData} reaction
 * @property {{tick:number,reactions:number,room:RoomGauge}} tick_complete
 * @property {HandData} hand_raised
 * @property {HandData} hand_lowered
 * @property {HandData} pooled
 * @property {HandData} question_taken
 * @property {HandData} qa_question
 * @property {{question_id:string,url:string,content_type:string}} question_audio
 * @property {{question_id:string,error:string}} question_audio_failed
 * @property {{question_id:string}} playback_start
 * @property {{question_id:string}} playback_end
 * @property {{question_id:string,listener:string,text:string}} answer
 * @property {{question_id:string,listener:string,persona:string,verdict:'answered'|'partial'|'dodged',comment:string}} answer_verdict
 * @property {{question_id:string,listener:string,error:string}} answer_eval_error
 * @property {{tick:number,listener:string,question:string,quote:string}} grounding_rejected
 * @property {{tick:number,listener:string}} listener_timeout
 * @property {{tick:number,listener:string}} listener_error
 * @property {Record<string,never>} skipped_tick
 * @property {{reason:string}} llm_fallback
 * @property {{size:number}} qa_pool
 */
/** @typedef {{type:'event',event:keyof EventData,t:number,data:EventData[keyof EventData],replay?:boolean}} EventEnvelope */
/** @typedef {{type:'hello',session:SessionInfo,events:EventEnvelope[]}} HelloEnvelope */
/** @typedef {HelloEnvelope|AckEnvelope|ErrorEnvelope|EventEnvelope} ServerEnvelope */

export const CLIENT_REQUEST_TYPES = Object.freeze([
  'start', 'transcript', 'slide', 'take_question', 'playback_started', 'playback_ended',
  'answer_done', 'end_presenting', 'next_question', 'end_qa', 'finish', 'ping',
]);

export const EVENT_NAMES = Object.freeze([
  'state', 'slide_change', 'transcript', 'transcript_dropped', 'tick_start', 'reaction',
  'tick_complete', 'hand_raised', 'hand_lowered', 'pooled', 'question_taken', 'qa_question',
  'question_audio', 'question_audio_failed', 'playback_start', 'playback_end', 'answer',
  'answer_verdict', 'answer_eval_error', 'grounding_rejected', 'listener_timeout',
  'listener_error', 'skipped_tick', 'llm_fallback', 'qa_pool',
]);

const record = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Lightweight envelope guard; domain validation remains on the backend. */
export function isServerEnvelope(value) {
  if (!record(value)) return false;
  if (value.type === 'hello') return record(value.session) && typeof value.session.id === 'string' && Array.isArray(value.events);
  if (value.type === 'ack') return typeof value.request === 'string' && record(value.result);
  if (value.type === 'error') return typeof value.message === 'string';
  return value.type === 'event' && typeof value.event === 'string' && Number.isFinite(value.t) && record(value.data);
}
