import { getMe } from "./api.js";
import { applyStaticTranslations, getStoredLanguage, setStoredLanguage } from "./i18n.js";

let language = setStoredLanguage(getStoredLanguage());
applyStaticTranslations(document, language);

document.querySelectorAll("[data-language-choice]").forEach(button => {
  button.classList.toggle("active", button.dataset.languageChoice === language);
  button.addEventListener("click", () => {
    language = setStoredLanguage(button.dataset.languageChoice);
    applyStaticTranslations(document, language);
    document.querySelectorAll("[data-language-choice]").forEach(choice => {
      choice.classList.toggle("active", choice.dataset.languageChoice === language);
    });
  });
});

const state = await getMe();
if (state.authenticated && state.profile_complete) {
  location.href = "/chat";
} else if (state.authenticated) {
  location.href = "/onboarding";
}
