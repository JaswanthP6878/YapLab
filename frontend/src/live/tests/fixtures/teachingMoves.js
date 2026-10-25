/** Public report contract examples: illustrative prompt and measured export. */
export const PROMPT_TEACHING_MOVES = {
  dataset: 'TalkMoves: 567 K-12 math lessons (Suresh et al., 2022), CC BY-NC-SA 4.0',
  model: { method: 'TF-IDF + logistic regression', accuracy: 0.72, macro_f1: 0.53 },
  sentences: 42,
  moves: [
    { key: 'keeping_together', label: 'Checking in with the room', f1: 0.57, count: 1, per_100: 2.4,
      benchmark: { median: 9.8, p25: 5.1, p75: 14.6, ci95_median: [8.9, 10.7], lessons: 504 },
      examples: ['Does that make sense so far?'] },
    { key: 'pressing_for_reasoning', label: 'Asking why', f1: 0.68, count: 2, per_100: 4.8,
      benchmark: { median: 0.6, p25: 0, p75: 1.8, ci95_median: [0.5, 0.8], lessons: 504 },
      examples: ['Why do you think that works?'] },
    { key: 'pressing_for_accuracy', label: 'Asking for precision', f1: 0.71, count: 0, per_100: 0,
      benchmark: { median: 13.7, p25: 9.9, p75: 18, ci95_median: [12.9, 14.4], lessons: 504 },
      examples: [] },
    { key: 'getting_students_to_relate', label: 'Connecting ideas', f1: 0.41, count: 3, per_100: 7.1,
      benchmark: { median: 1.1, p25: 0, p75: 3, ci95_median: [0.9, 1.3], lessons: 504 },
      examples: ['How does your example connect to the earlier idea?'] },
  ],
};

export const MEASURED_TEACHING_MOVES = {
  ...PROMPT_TEACHING_MOVES,
  model: { method: 'TF-IDF + logistic regression', accuracy: 0.7322905894519132, macro_f1: 0.5349510861539507 },
  moves: PROMPT_TEACHING_MOVES.moves.map((move, index) => ({
    ...move,
    f1: [0.5719506624029237, 0.6739811912225705, 0.7151330798479087, 0.4222222222222222][index],
    benchmark: [
      { median: 13.612237019880332, p25: 9.733203195190878, p75: 19.165440838466488, ci95_median: [12.78423772609819, 14.09406728618138], lessons: 566 },
      { median: 0.6417119639817712, p25: 0, p75: 1.8461538461538463, ci95_median: [0.4994388327721661, 0.7504810700876094], lessons: 566 },
      { median: 13.708670471299477, p25: 9.869613721935574, p75: 17.96120546120546, ci95_median: [12.8863853434054, 14.354066985645932], lessons: 566 },
      { median: 1.0976654529877918, p25: 0, p75: 3.0418397169666203, ci95_median: [0.9203233365014538, 1.3245033112582782], lessons: 566 },
    ][index],
  })),
};

export function reportWithTeachingMoves(teaching_moves) {
  return {
    session_id: 'teaching-moves-fixture',
    ticks: [],
    questions: { raised: 0, asked: 0, verdicts: { answered: 0, partial: 0, dodged: 0 }, answers: [] },
    delivery: { duration_seconds: 60, words: 120, words_per_minute: 120, filler_words: 0, longest_pause_seconds: 1.5 },
    ...(teaching_moves === undefined ? {} : { teaching_moves }),
  };
}
