import { ABS } from "./absDaily.js";
import { COLD } from "./coldShower.js";
import { CONTENT30 } from "./content30.js";
import { DECLUTTER } from "./declutter.js";
import { ENGLISH } from "./englishZero.js";
import { GRATITUDE } from "./gratitude30.js";
import { JOURNAL } from "./journal30.js";
import { MEDITATION } from "./meditation10.js";
import { MORNING } from "./morningWorkout.js";
import { NO_QUIT } from "./noQuit.js";
import { PLANK } from "./plank5.js";
import { PUSHUPS } from "./pushups100.js";
import { READ10 } from "./readTen.js";
import { SQUATS } from "./squats100.js";
import { STEPS } from "./steps10000.js";
import { STRETCH } from "./stretching15.js";
import type { ChallengeContent } from "./types.js";
import { WAKE } from "./wake0500.js";
import { WATER } from "./water2l.js";

/** Все челленджи с готовым наполнением. Новый — добавить файл в эту папку и сюда. */
export const CONTENT: ChallengeContent[] = [COLD, WAKE, PUSHUPS, STEPS, PLANK, ABS, SQUATS, MORNING, STRETCH, ENGLISH, READ10, WATER, JOURNAL, MEDITATION, DECLUTTER, CONTENT30, GRATITUDE, NO_QUIT];
