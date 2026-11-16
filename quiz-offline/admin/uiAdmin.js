// admin/uiAdmin.js
import { DEFAULT_SETTINGS, DEFAULT_CUSTOMIZATIONS } from '../js/constants.js';
import { getFromLocalStorage, showAlert, showConfirm } from '../js/utils.js';

const CUSTOM_LOGO_FILENAME_KEY = 'quizCustomLogoFileName';
const DEFAULT_LOGO_SRC = "assets/logo.png";

const htmlEl = document.documentElement;
const fontSizesInPx = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
let currentFontStepIndex; // Será inicializado por loadFontPreference

// Funções de UI exportadas
export const displayStatusMessage = (element, message, type = 'info', duration = 3000) => {
    if (element) {
        element.textContent = message;
        element.className = `status-message ${type}`;
        if (duration > 0) {
            setTimeout(() => {
                if (element.textContent === message) {
                    element.textContent = '';
                    element.className = 'status-message';
                }
            }, duration);
        }
    }
};

const updateFontButtons = () => {
    const decreaseBtn = document.getElementById('decrease-font');
    const increaseBtn = document.getElementById('increase-font');
    if (decreaseBtn) decreaseBtn.disabled = currentFontStepIndex === 0;
    if (increaseBtn) increaseBtn.disabled = currentFontStepIndex === fontSizesInPx.length - 1;
};

export const applyFontSize = () => {
    if (currentFontStepIndex < 0) currentFontStepIndex = 0;
    if (currentFontStepIndex >= fontSizesInPx.length) currentFontStepIndex = fontSizesInPx.length - 1;
    htmlEl.style.fontSize = `${fontSizesInPx[currentFontStepIndex]}px`;
    updateFontButtons();
};

export const loadFontPreference = () => {
    let initialIndex = fontSizesInPx.indexOf(18);
    if (initialIndex === -1) initialIndex = fontSizesInPx.indexOf(16);
    if (initialIndex === -1) initialIndex = Math.floor(fontSizesInPx.length / 2);
    currentFontStepIndex = initialIndex;
    applyFontSize();
};

export const decreaseFontSize = () => {
    if (currentFontStepIndex > 0) {
        currentFontStepIndex--;
        applyFontSize();
    }
};

export const increaseFontSize = () => {
    if (currentFontStepIndex < fontSizesInPx.length - 1) {
        currentFontStepIndex++;
        applyFontSize();
    }
};

export const applyCustomLogo = (logoFileName) => {
    const logoSrc = logoFileName ? `assets/${logoFileName}` : DEFAULT_LOGO_SRC;
    const logoElements = document.querySelectorAll('.caesb-logo');
    logoElements.forEach(logoEl => {
        logoEl.src = logoSrc;
        logoEl.onerror = () => {
            logoEl.src = DEFAULT_LOGO_SRC;
            const logoStatusMessageEl = document.getElementById('logo-status-message');
            if (logoStatusMessageEl && logoFileName) {
                displayStatusMessage(logoStatusMessageEl, `Erro: Arquivo '${logoFileName}' não encontrado em 'assets/'. Usando logo padrão.`, 'error');
            }
        };
    });
    const logoPreviewImg = document.getElementById('logo-preview-img');
    if (logoPreviewImg) {
        logoPreviewImg.src = logoSrc;
        logoPreviewImg.onerror = () => { logoPreviewImg.src = DEFAULT_LOGO_SRC; };
    }
};

export const loadCustomLogo = () => {
    const customLogoFileName = localStorage.getItem(CUSTOM_LOGO_FILENAME_KEY);
    applyCustomLogo(customLogoFileName);
};

export const applyAdminThemeCustomizations = (quizCustomizations) => {
    const adminBody = document.body;
    const adminBgColor = quizCustomizations.colors.quizMainBackground || DEFAULT_CUSTOMIZATIONS.colors.quizMainBackground;
    adminBody.style.backgroundColor = adminBgColor;
};

export const applyCustomBackground = (settings, quizCustomizations) => {
    const adminBody = document.body;
    // const adminPageContainer = document.querySelector('.admin-page-container'); // Não é usado aqui diretamente
    if (settings.enableCustomBackground && settings.customBackgroundFileName) {
        const imgPath = `assets/${settings.customBackgroundFileName}`;
        adminBody.style.backgroundImage = `url('${imgPath}')`;
        adminBody.style.backgroundSize = 'cover';
        adminBody.style.backgroundPosition = 'center bottom';
        adminBody.style.backgroundRepeat = 'no-repeat';
        adminBody.style.backgroundColor = '';
    } else {
        adminBody.style.backgroundImage = '';
        adminBody.style.backgroundColor = quizCustomizations.colors.quizMainBackground || DEFAULT_CUSTOMIZATIONS.colors.quizMainBackground;
    }
};

export const applyDevModeVisuals = (devModeActive) => {
    const adminPageContainer = document.querySelector('.admin-page-container');
    if (adminPageContainer) {
        if (devModeActive) {
            adminPageContainer.classList.add('admin-dev-mode-active');
        } else {
            adminPageContainer.classList.remove('admin-dev-mode-active');
        }
    }
};