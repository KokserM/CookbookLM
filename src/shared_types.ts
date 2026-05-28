export interface ExtractedRecipe {
  title: string;
  source_url: string;
  servings?: string | undefined;
  times?: { prep?: string | undefined; cook?: string | undefined; total?: string | undefined } | undefined;
  hero_image_url?: string | undefined;
  ingredients: string[];
  steps: string[];
}

export type OutputLanguage = "et" | "en";
export type MeasurementPreference = "metric" | "imperial" | "source" | "mixed";
export type PdfPageFormat = "a4" | "letter" | "legal" | "a5";
export type AllergenId = "gluten" | "dairy" | "egg" | "peanut" | "treeNut" | "soy" | "fish" | "shellfish" | "sesame";
export type AiTaskType = "none" | "translate_only" | "substitution_general" | "allergen_adaptation" | "validation_only" | "cleanup_extraction";
export type ModelRoutingMode = "balanced" | "best_quality" | "lowest_cost";

export interface AllergenContextItem {
  idx?: number | undefined;
  allergen: AllergenId;
  ingredient: string;
  matched: string[];
  role?: string;
  relevantSteps?: number[] | undefined;
  severity: "contains" | "may_contain" | "hidden_source";
  guidance: string;
}

export interface RecipeEtResult {
  title_et: string;
  source_url: string;
  source_domain: string;
  servings?: string | undefined;
  times?: { prep?: string | undefined; cook?: string | undefined; total?: string | undefined } | undefined;
  hero_image_url?: string | undefined;
  ingredients: Array<{
    original: string;
    et: string;
    metric_notes?: string | undefined;
  }>;
  steps: Array<{
    original: string;
    et: string;
  }>;
  substitutions: Array<{
    ingredient: string;
    suggestions_et: string[];
    note_et?: string | undefined;
  }>;
  warnings_et?: string[] | undefined;
}

export interface TranslateResultEt {
  title: string;
  ingredients: string[]; // same length/order as input ingredients_in
  steps: string[]; // same length/order as steps_in
  extra_substitutions?: Array<{ ingredient_in: string; suggestions_et: string[]; note_et?: string | undefined }> | undefined;
  warnings?: string[] | undefined;
}

export type PopupToWorkerMessage =
  | {
      type: "AI_PROCESS_RECIPE";
      payload: {
        extracted: ExtractedRecipe;
        includeSubstitutions: boolean;
        glutenFree?: boolean;
        allergenModes?: AllergenId[];
        model?: string;
      };
    }
  | {
      type: "START_GENERATE_PDF_JOB";
      payload: {
        extracted: ExtractedRecipe;
        includeSubstitutions: boolean;
        glutenFree?: boolean;
        allergenModes?: AllergenId[];
        model?: string;
      };
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
  error?: string | undefined;
  recipeTitle?: string | undefined;
  sourceUrl?: string | undefined;
};



