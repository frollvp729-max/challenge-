import { ABS } from "./absDaily.js";
import { COLD } from "./coldShower.js";
import { MORNING } from "./morningWorkout.js";
import { PLANK } from "./plank5.js";
import { PUSHUPS } from "./pushups100.js";
import { SQUATS } from "./squats100.js";
import { STEPS } from "./steps10000.js";
import { STRETCH } from "./stretching15.js";
import type { ChallengeContent } from "./types.js";
import { WAKE } from "./wake0500.js";

/** Все челленджи с готовым наполнением. Новый — добавить файл в эту папку и сюда. */
export const CONTENT: ChallengeContent[] = [COLD, WAKE, PUSHUPS, STEPS, PLANK, ABS, SQUATS, MORNING, STRETCH];
