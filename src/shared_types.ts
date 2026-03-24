export interface ExtractedRecipe {
  title: string;
  source_url: string;
  servings?: string;
  times?: { prep?: string; cook?: string; total?: string };
  hero_image_url?: string;
  ingredients: string[];
  steps: string[];
}

export interface RecipeEtResult {
  title_et: string;
  source_url: string;
  source_domain: string;
  servings?: string;
  times?: { prep?: string; cook?: string; total?: string };
  hero_image_url?: string;
  ingredients: Array<{
    original: string;
    et: string;
    metric_notes?: string;
  }>;
  steps: Array<{
    original: string;
    et: string;
  }>;
  substitutions: Array<{
    ingredient: string;
    suggestions_et: string[];
    note_et?: string;
  }>;
  warnings_et?: string[];
}

export interface TranslateResultEt {
  title: string;
  ingredients: string[]; // same length/order as input ingredients_in
  steps: string[]; // same length/order as steps_in
  extra_substitutions?: Array<{ ingredient_in: string; suggestions_et: string[]; note_et?: string }>;
  warnings?: string[];
}

export type PopupToWorkerMessage =
  | {
      type: "AI_PROCESS_RECIPE";
      payload: { extracted: ExtractedRecipe; includeSubstitutions: boolean; glutenFree: boolean; model?: string };
    }
  | {
      type: "START_GENERATE_PDF_JOB";
      payload: { extracted: ExtractedRecipe; includeSubstitutions: boolean; glutenFree: boolean; model?: string };
    }
  | { type: "GET_JOB_STATUS" }
  | { type: "FETCH_IMAGE_DATAURL"; payload: { url: string } };

export type WorkerToPopupMessage =
  | { type: "AI_PROCESS_RECIPE_RESULT"; payload: { result: RecipeEtResult } }
  | { type: "AI_PROCESS_RECIPE_ERROR"; payload: { message: string } }
  | { type: "JOB_STATUS"; payload: { status: JobStatusState } }
  | { type: "FETCH_IMAGE_DATAURL_RESULT"; payload: { dataUrl?: string } }
  | { type: "FETCH_IMAGE_DATAURL_ERROR"; payload: { message: string } };

export type PopupToTabMessage = { type: "EXTRACT_RECIPE" };

export type JobStage = "idle" | "extracting" | "ai_processing" | "generating_pdf" | "downloading" | "done" | "error";

export type JobStatusState = {
  stage: JobStage;
  message: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};



