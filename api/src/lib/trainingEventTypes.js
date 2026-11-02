export const trainingEventTypes=new Set([
  "competition_training",
  "winter_training",
  "summer_training",
  "intensive_training"
]);

export const isTrainingEventType=value=>trainingEventTypes.has(String(value||""));
