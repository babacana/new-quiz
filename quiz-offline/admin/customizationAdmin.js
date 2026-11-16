// admin/customizationAdmin.js
import { getFromLocalStorage, saveToLocalStorage, showConfirm, debounce } from '../js/utils.js';
import { displayStatusMessage, applyAdminThemeCustomizations, applyCustomBackground } from './uiAdmin.js';
import { DEFAULT_CUSTOMIZATIONS, PREDEFINED_THEMES, DEFAULT_LOGO_SRC } from '../js/constants.js'; // PREDEFINED_THEMES será adicionado em constants.js

// Referências DOM
let saveCustomizationsBtn, restoreDefaultCustomizationsBtn, customizationStatusMessageEl;
let accordionHeaders;
let previewContentArea, previewScreenSelectorButtons;
let logoPreviewImg, backgroundOpacitySlider, backgroundOpacityValueDisplay;
let themesGalleryContainer;
let resetSectionBtns;

// Callbacks e referências de estado de admin.js
let localQuizCustomizationsRef;
let localIsCustomizationsDirtyRef;
let localInitialCustomizationsDataRef;
let localResetDirtyFlagAndCaptureState;
let localCheckDirtyState;
let localSettingsRef; // Para applyCustomBackground

const QUIZ_CUSTOMIZATIONS_KEY = 'quizThemeCustomizations';

// --- Funções do Accordion ---
function initializeAccordions() {
    accordionHeaders = document.querySelectorAll('#admin-customization-screen .accordion-header');
    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isExpanded = header.getAttribute('aria-expanded') === 'true';

            // Fecha todos os outros accordions
            // accordionHeaders.forEach(otherHeader => {
            //     if (otherHeader !== header) {
            //         otherHeader.setAttribute('aria-expanded', 'false');
            //         otherHeader.nextElementSibling.style.maxHeight = null;
            //         otherHeader.nextElementSibling.classList.remove('expanded');
            //     }
            // });

            header.setAttribute('aria-expanded', !isExpanded);
            if (!isExpanded) {
                content.classList.add('expanded');
                // Forçar reflow e adicionar um pequeno delay para garantir que scrollHeight seja calculado corretamente
                // após 'expanded' ser adicionado e o conteúdo (especialmente botões com quebra de linha) ser renderizado.
                void content.offsetHeight;
                setTimeout(() => {
                    content.style.maxHeight = content.scrollHeight + "px";
                }, 200); // Aumentado delay para 200ms
            } else {
                content.style.maxHeight = null;
                content.classList.remove('expanded');
            }
        });
        // Por padrão, o primeiro accordion pode vir aberto ou todos fechados
        if (header.getAttribute('aria-expanded') === 'true') {
             const contentToExpand = header.nextElementSibling;
             contentToExpand.classList.add('expanded');
             void contentToExpand.offsetHeight; // Forçar reflow
             setTimeout(() => {
                contentToExpand.style.maxHeight = contentToExpand.scrollHeight + "px";
             }, 200); // Aumentado delay para 200ms
        }
    });
}

// --- Funções de Pré-visualização ---
let currentPreviewScreen = 'initial'; // 'initial', 'quiz', 'result'

function updatePreviewScreen(screenName) {
    currentPreviewScreen = screenName;
    // Lógica para renderizar o conteúdo da tela de preview (simplificado)
    // Isso será mais elaborado, buscando elementos na área de preview e atualizando-os
    if (!previewContentArea) return;

    let htmlContent = '';
    const customizations = _getCustomizationsFromUI(false); // Pega os valores atuais da UI

    // Garantir que customizations.visualIdentity exista
    const visualIdentity = customizations.visualIdentity || DEFAULT_CUSTOMIZATIONS.visualIdentity;
    const texts = customizations.texts || DEFAULT_CUSTOMIZATIONS.texts;
    const colors = customizations.colors || DEFAULT_CUSTOMIZATIONS.colors;
    const fontSizes = customizations.fontSizes || DEFAULT_CUSTOMIZATIONS.fontSizes;


    // Atualiza as variáveis CSS globais para a pré-visualização
    const root = document.documentElement; // Ou um elemento root específico para o preview
    Object.keys(colors).forEach(key => {
        root.style.setProperty(`--preview-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, colors[key]);
    });
    Object.keys(fontSizes).forEach(key => {
         root.style.setProperty(`--preview-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, fontSizes[key]);
    });
    
    root.style.setProperty('--preview-background-image-opacity', visualIdentity.customBackgroundOpacity);
    if (visualIdentity.enableCustomBackground && visualIdentity.customBackgroundFileName) {
        root.style.setProperty('--preview-background-image', `url('../assets/${visualIdentity.customBackgroundFileName}')`);
    } else {
        root.style.setProperty('--preview-background-image', 'none');
    }


    // Simulação de conteúdo para cada tela
    switch (screenName) {
        case 'initial':
            htmlContent = `
                <div class="preview-initial-screen" style="background-color: var(--preview-quiz-main-background); color: var(--preview-quiz-main-text-color); font-family: var(--preview-main-font-family);">
                    <img src="${visualIdentity.logoFileName ? 'assets/' + visualIdentity.logoFileName : DEFAULT_LOGO_SRC}" alt="Logo" style="max-width: 150px; max-height: 70px; margin-bottom: 10px;">
                    <h2 style="color: var(--preview-quiz-highlight-color);">${texts.initialScreenTitle}</h2>
                    <p class="slogan" style="font-size: var(--preview-initial-slogan-font-size); color: var(--preview-quiz-highlight-color);">${texts.initialScreenSlogan}</p>
                    <input type="text" placeholder="${texts.inputNamePlaceholder}" style="border: 1px solid var(--preview-quiz-input-border-color); color: var(--preview-quiz-input-placeholder-color); background-color: rgba(255,255,255,0.1); padding: 8px; margin-bottom: 5px; width: 80%;">
                    <button class="btn-preview-primary" style="background-color: var(--preview-quiz-primary-button-bg); color: var(--preview-quiz-primary-button-text); font-size: var(--preview-main-buttons-font-size); padding:10px;">${texts.initialScreenStartButton}</button>
                </div>`;
            break;
        case 'quiz':
            htmlContent = `
                <div class="preview-quiz-screen" style="background-color: var(--preview-quiz-main-background); color: var(--preview-quiz-main-text-color); font-family: var(--preview-main-font-family);">
                    <p style="font-size: var(--preview-question-text-font-size);">Texto da Pergunta de Exemplo?</p>
                    <div style="margin-top:10px;">
                        <button style="background-color: var(--preview-quiz-option-bg); color: var(--preview-quiz-option-text); border: 1px solid var(--preview-quiz-secondary-button-border); padding: 8px; margin: 2px; display:block; width: 80%; margin-left:auto; margin-right:auto;">Opção A</button>
                        <button style="background-color: var(--preview-quiz-option-correct-bg); color: #fff; border: 1px solid var(--preview-quiz-secondary-button-border); padding: 8px; margin: 2px; display:block; width: 80%; margin-left:auto; margin-right:auto;">Opção B (Correta)</button>
                    </div>
                    <button class="btn-preview-primary" style="margin-top:15px; background-color: var(--preview-quiz-primary-button-bg); color: var(--preview-quiz-primary-button-text); font-size: var(--preview-main-buttons-font-size); padding:10px;">${texts.quizScreenNextButton}</button>
                </div>`;
            break;
        case 'result':
            htmlContent = `
                <div class="preview-result-screen" style="background-color: var(--preview-quiz-main-background); color: var(--preview-quiz-main-text-color); font-family: var(--preview-main-font-family);">
                    <h3 style="color: var(--preview-quiz-highlight-color);">${texts.resultScreenPrizeWon}</h3>
                    <button class="btn-preview-secondary" style="background-color: var(--preview-quiz-secondary-button-bg); color: var(--preview-quiz-secondary-button-text); border: 1px solid var(--preview-quiz-secondary-button-border); font-size: var(--preview-main-buttons-font-size); padding:10px;">${texts.resultScreenPlayAgainButton}</button>
                </div>`;
            break;
        default:
            htmlContent = '<p>Selecione uma tela para pré-visualizar.</p>';
    }
    previewContentArea.innerHTML = htmlContent;

    // Atualiza botões seletores
    previewScreenSelectorButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.previewTarget === screenName);
    });
}

const debouncedUpdatePreview = debounce(updatePreviewScreen, 250);

function initializePreviewSystem() {
    previewContentArea = document.getElementById('preview-content-area');
    previewScreenSelectorButtons = document.querySelectorAll('.preview-screen-selector button');

    previewScreenSelectorButtons.forEach(button => {
        button.addEventListener('click', () => {
            updatePreviewScreen(button.dataset.previewTarget);
        });
    });
    // Carrega a preview inicial
    updatePreviewScreen(currentPreviewScreen);
}


// --- Coleta e Carregamento de Dados ---
function _getCustomizationsFromUI(forSaving = true) {
    const customizations = {
        texts: {},
        colors: {},
        fontSizes: {}, // Mantido para os tamanhos, fontFamily será separado ou aqui dentro
        visualIdentity: {}
    };

    // Textos
    document.querySelectorAll('#admin-customization-screen [id^="custom-text-"]').forEach(el => {
        const key = el.id.replace('custom-text-', '');
        customizations.texts[key] = el.value.trim() || (forSaving ? DEFAULT_CUSTOMIZATIONS.texts[key] : '');
    });

    // Cores
    document.querySelectorAll('#admin-customization-screen [id^="custom-color-"]').forEach(el => {
        const key = el.id.replace('custom-color-', '');
        customizations.colors[key] = el.value || (forSaving ? DEFAULT_CUSTOMIZATIONS.colors[key] : '#000000');
    });

    // Tamanhos de Fonte e Família de Fonte
    document.querySelectorAll('#admin-customization-screen [id^="custom-fontSize-"]').forEach(el => {
        const key = el.id.replace('custom-fontSize-', '');
        customizations.fontSizes[key] = el.value.trim() || (forSaving ? DEFAULT_CUSTOMIZATIONS.fontSizes[key] : '');
    });
    const fontFamilyEl = document.getElementById('custom-fontFamily-main');
    if (fontFamilyEl) {
        customizations.fontSizes.mainFontFamily = fontFamilyEl.value || (forSaving ? DEFAULT_CUSTOMIZATIONS.fontSizes.mainFontFamily : DEFAULT_CUSTOMIZATIONS.fontSizes.mainFontFamily);
    }


    // Identidade Visual
    const logoFilenameEl = document.getElementById('logo-filename-input');
    customizations.visualIdentity.logoFileName = logoFilenameEl ? logoFilenameEl.value.trim() : (forSaving ? DEFAULT_CUSTOMIZATIONS.visualIdentity.logoFileName : '');

    const bgFilenameEl = document.getElementById('background-filename-input');
    customizations.visualIdentity.customBackgroundFileName = bgFilenameEl ? bgFilenameEl.value.trim() : (forSaving ? DEFAULT_CUSTOMIZATIONS.visualIdentity.customBackgroundFileName : '');
    
    const enableCustomBgEl = document.getElementById('enable-custom-background');
    customizations.visualIdentity.enableCustomBackground = enableCustomBgEl ? enableCustomBgEl.checked : (forSaving ? DEFAULT_CUSTOMIZATIONS.visualIdentity.enableCustomBackground : false);

    const bgOpacityEl = document.getElementById('custom-backgroundOpacity');
    customizations.visualIdentity.customBackgroundOpacity = bgOpacityEl ? parseFloat(bgOpacityEl.value) : (forSaving ? DEFAULT_CUSTOMIZATIONS.visualIdentity.customBackgroundOpacity : 1);

    return customizations;
}

function _getCustomizationsFormDataFromDOM() { // Usado para dirty checking
    const data = _getCustomizationsFromUI(false); // Pega valores atuais, sem fallback para default se vazio
    return JSON.stringify(data);
}

function _loadAdminCustomizationsToUI(customizationsToLoad = null) {
    const currentCustomizations = customizationsToLoad || getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY, DEFAULT_CUSTOMIZATIONS);
    localQuizCustomizationsRef.value = JSON.parse(JSON.stringify(currentCustomizations)); // Deep copy

    // Textos
    for (const key in DEFAULT_CUSTOMIZATIONS.texts) {
        const inputEl = document.getElementById(`custom-text-${key}`);
        if (inputEl) {
            inputEl.value = currentCustomizations.texts[key] || DEFAULT_CUSTOMIZATIONS.texts[key];
        }
    }
    // Cores
    for (const key in DEFAULT_CUSTOMIZATIONS.colors) {
        const inputEl = document.getElementById(`custom-color-${key}`);
        if (inputEl) {
            inputEl.value = currentCustomizations.colors[key] || DEFAULT_CUSTOMIZATIONS.colors[key];
        }
    }
     // Cores Novas
    const inputBorderEl = document.getElementById('custom-color-inputBorder');
    if (inputBorderEl) inputBorderEl.value = currentCustomizations.colors.quizInputBorder || DEFAULT_CUSTOMIZATIONS.colors.quizInputBorder;
    const inputPlaceholderEl = document.getElementById('custom-color-inputPlaceholder');
    if (inputPlaceholderEl) inputPlaceholderEl.value = currentCustomizations.colors.quizInputPlaceholder || DEFAULT_CUSTOMIZATIONS.colors.quizInputPlaceholder;


    // Tamanhos de Fonte
    for (const key in DEFAULT_CUSTOMIZATIONS.fontSizes) {
        const inputEl = document.getElementById(`custom-fontSize-${key}`);
        if (inputEl) {
            inputEl.value = currentCustomizations.fontSizes[key] || DEFAULT_CUSTOMIZATIONS.fontSizes[key];
        }
    }
    // Família da Fonte
    const fontFamilyEl = document.getElementById('custom-fontFamily-main');
    if (fontFamilyEl) {
        fontFamilyEl.value = currentCustomizations.fontSizes.mainFontFamily || DEFAULT_CUSTOMIZATIONS.fontSizes.mainFontFamily;
    }

    // Identidade Visual
    const visualIdentity = currentCustomizations.visualIdentity || DEFAULT_CUSTOMIZATIONS.visualIdentity;
    const logoFilenameEl = document.getElementById('logo-filename-input');
    if (logoFilenameEl) logoFilenameEl.value = visualIdentity.logoFileName || '';
    if (logoPreviewImg) logoPreviewImg.src = visualIdentity.logoFileName ? `assets/${visualIdentity.logoFileName}` : DEFAULT_LOGO_SRC;
    
    const bgFilenameEl = document.getElementById('background-filename-input');
    if (bgFilenameEl) bgFilenameEl.value = visualIdentity.customBackgroundFileName || '';
    
    const enableCustomBgEl = document.getElementById('enable-custom-background');
    if (enableCustomBgEl) enableCustomBgEl.checked = visualIdentity.enableCustomBackground || false;

    if (backgroundOpacitySlider) {
        backgroundOpacitySlider.value = visualIdentity.customBackgroundOpacity || 1;
        if (backgroundOpacityValueDisplay) {
            backgroundOpacityValueDisplay.textContent = `${Math.round(backgroundOpacitySlider.value * 100)}%`;
        }
    }
    
    localInitialCustomizationsDataRef.value = _getCustomizationsFormDataFromDOM();
    localIsCustomizationsDirtyRef.value = false;
    debouncedUpdatePreview(currentPreviewScreen); // Atualiza a pré-visualização
}

// --- Salvamento e Restauração ---
function _saveQuizCustomizationsHandler(isNavigating = false) {
    const newCustomizations = _getCustomizationsFromUI(true); // true para usar defaults se campos estiverem vazios

    saveToLocalStorage(QUIZ_CUSTOMIZATIONS_KEY, newCustomizations);
    localQuizCustomizationsRef.value = JSON.parse(JSON.stringify(newCustomizations));
    localResetDirtyFlagAndCaptureState('customizations', _getCustomizationsFormDataFromDOM());

    applyAdminThemeCustomizations(newCustomizations); // Aplica ao admin (se houver)
    if (localSettingsRef && localSettingsRef.value) {
        // Passa o objeto visualIdentity para applyCustomBackground
        const settingsForBg = { 
            ...localSettingsRef.value, // Mantém settings existentes
            customBackgroundFileName: newCustomizations.visualIdentity.customBackgroundFileName,
            enableCustomBackground: newCustomizations.visualIdentity.enableCustomBackground,
            customBackgroundOpacity: newCustomizations.visualIdentity.customBackgroundOpacity
        };
        applyCustomBackground(settingsForBg, newCustomizations); // Aplica ao quiz principal
    }
    
    if (!isNavigating) {
        displayStatusMessage(customizationStatusMessageEl, 'Personalizações salvas com sucesso!', 'success');
    }
    debouncedUpdatePreview(currentPreviewScreen);
    return true;
}

function _restoreDefaultQuizCustomizations(sectionKey = null) {
    const defaultsCopy = JSON.parse(JSON.stringify(DEFAULT_CUSTOMIZATIONS));
    let message = "Restaurar todas as personalizações para o padrão?";
    let customizationsToApply = defaultsCopy;

    if (sectionKey) {
        const currentCustoms = _getCustomizationsFromUI(false); // Pega os valores atuais da UI
        message = `Restaurar padrões da seção "${sectionKey}"?`;
        
        switch(sectionKey) {
            case 'appearance':
                currentCustoms.colors = { ...defaultsCopy.colors };
                currentCustoms.fontSizes = { ...defaultsCopy.fontSizes }; // Inclui fontFamily
                break;
            case 'texts':
                currentCustoms.texts = { ...defaultsCopy.texts };
                break;
            case 'visualIdentity':
                currentCustoms.visualIdentity = { ...defaultsCopy.visualIdentity };
                break;
            default: // Não deve acontecer se os botões estiverem corretos
                _loadAdminCustomizationsToUI(); // Recarrega tudo
                debouncedUpdatePreview(currentPreviewScreen);
                localCheckDirtyState('customizations');
                return;
        }
        customizationsToApply = currentCustoms;
    }

    showConfirm(message, {
        onDiscardAndProceed: () => {
            if (!sectionKey) { // Reset global
                saveToLocalStorage(QUIZ_CUSTOMIZATIONS_KEY, customizationsToApply);
            }
            _loadAdminCustomizationsToUI(customizationsToApply); // Carrega os defaults (ou defaults parciais) na UI
            
            // Se for reset de seção, precisamos salvar o estado modificado
            if (sectionKey) {
                 _saveQuizCustomizationsHandler(true); // Salva silenciosamente
            } else {
                // Para reset global, aplicamos diretamente
                applyAdminThemeCustomizations(customizationsToApply);
                 if (localSettingsRef && localSettingsRef.value) {
                    const settingsForBg = { 
                        ...localSettingsRef.value,
                        customBackgroundFileName: customizationsToApply.visualIdentity.customBackgroundFileName,
                        enableCustomBackground: customizationsToApply.visualIdentity.enableCustomBackground,
                        customBackgroundOpacity: customizationsToApply.visualIdentity.customBackgroundOpacity
                    };
                    applyCustomBackground(settingsForBg, customizationsToApply);
                }
            }

            displayStatusMessage(customizationStatusMessageEl, sectionKey ? `Padrões da seção "${sectionKey}" restaurados.` : 'Personalizações restauradas para o padrão.', 'info');
            localCheckDirtyState('customizations');
            debouncedUpdatePreview(currentPreviewScreen);
        }
    }, 'warning', { discardButtonText: "Sim, Restaurar" });
}


// --- Temas Pré-definidos ---
function populateThemesGallery() {
    if (!themesGalleryContainer || !PREDEFINED_THEMES) return;
    themesGalleryContainer.innerHTML = ''; // Limpa galeria

    PREDEFINED_THEMES.forEach(theme => {
        const themeCard = document.createElement('div');
        themeCard.classList.add('theme-card');
        themeCard.dataset.themeId = theme.id;
        
        // Simples preview de cor de fundo e texto
        const previewBox = document.createElement('div');
        previewBox.classList.add('theme-card-preview');
        previewBox.style.backgroundColor = theme.customizations.colors.quizMainBackground || DEFAULT_CUSTOMIZATIONS.colors.quizMainBackground;
        previewBox.style.color = theme.customizations.colors.quizMainTextColor || DEFAULT_CUSTOMIZATIONS.colors.quizMainTextColor;
        previewBox.textContent = theme.name.substring(0,1).toUpperCase(); // Inicial do nome do tema

        const themeName = document.createElement('h6');
        themeName.textContent = theme.name;

        themeCard.appendChild(previewBox);
        themeCard.appendChild(themeName);
        themesGalleryContainer.appendChild(themeCard);

        themeCard.addEventListener('click', () => applyPredefinedTheme(theme.id));
    });
}

function applyPredefinedTheme(themeId) {
    const theme = PREDEFINED_THEMES.find(t => t.id === themeId);
    if (!theme) return;

    // Cria uma cópia profunda dos defaults e mescla com o tema
    const newCustoms = JSON.parse(JSON.stringify(DEFAULT_CUSTOMIZATIONS));

    // Mescla textos
    if (theme.customizations.texts) {
        newCustoms.texts = { ...newCustoms.texts, ...theme.customizations.texts };
    }
    // Mescla cores
    if (theme.customizations.colors) {
        newCustoms.colors = { ...newCustoms.colors, ...theme.customizations.colors };
    }
    // Mescla fontSizes (incluindo fontFamily)
    if (theme.customizations.fontSizes) {
        newCustoms.fontSizes = { ...newCustoms.fontSizes, ...theme.customizations.fontSizes };
    }
    // Mescla visualIdentity
    if (theme.customizations.visualIdentity) {
        newCustoms.visualIdentity = { ...newCustoms.visualIdentity, ...theme.customizations.visualIdentity };
    }

    _loadAdminCustomizationsToUI(newCustoms);
    localCheckDirtyState('customizations'); // Marcar como dirty após aplicar tema
    displayStatusMessage(customizationStatusMessageEl, `Tema "${theme.name}" aplicado. Salve para confirmar.`, 'info');
    debouncedUpdatePreview(currentPreviewScreen);
}


// --- Inicialização ---
export function initializeCustomizationScreen(dependencies) {
    localQuizCustomizationsRef = dependencies.quizCustomizationsRef;
    localIsCustomizationsDirtyRef = dependencies.isCustomizationsDirtyRef;
    localInitialCustomizationsDataRef = dependencies.initialCustomizationsDataRef;
    localResetDirtyFlagAndCaptureState = dependencies.resetDirtyFlagAndCaptureStateCallback;
    localCheckDirtyState = dependencies.checkDirtyStateCallback;
    localSettingsRef = dependencies.settingsRef;

    saveCustomizationsBtn = document.getElementById('save-customizations-btn');
    restoreDefaultCustomizationsBtn = document.getElementById('restore-default-customizations-btn');
    customizationStatusMessageEl = document.getElementById('customization-status-message');
    
    logoPreviewImg = document.getElementById('logo-preview-img');
    backgroundOpacitySlider = document.getElementById('custom-backgroundOpacity');
    backgroundOpacityValueDisplay = document.getElementById('custom-backgroundOpacity-value');
    themesGalleryContainer = document.getElementById('predefined-themes-gallery');
    resetSectionBtns = document.querySelectorAll('.btn-reset-section');

    if (saveCustomizationsBtn) saveCustomizationsBtn.addEventListener('click', () => _saveQuizCustomizationsHandler(false));
    if (restoreDefaultCustomizationsBtn) restoreDefaultCustomizationsBtn.addEventListener('click', () => _restoreDefaultQuizCustomizations());

    resetSectionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sectionKey = btn.dataset.sectionReset;
            if (sectionKey) {
                _restoreDefaultQuizCustomizations(sectionKey);
            }
        });
    });
    
    // Event listeners para atualização da pré-visualização e dirty check
    const inputs = document.querySelectorAll('#admin-customization-screen input, #admin-customization-screen textarea, #admin-customization-screen select');
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            localCheckDirtyState('customizations');
            debouncedUpdatePreview(currentPreviewScreen);
        });
         // Para color pickers, 'change' pode ser mais apropriado que 'input' em alguns browsers
        if (input.type === 'color') {
            input.addEventListener('change', () => {
                 localCheckDirtyState('customizations');
                 debouncedUpdatePreview(currentPreviewScreen);
            });
        }
    });

    if (backgroundOpacitySlider && backgroundOpacityValueDisplay) {
        backgroundOpacitySlider.addEventListener('input', () => {
            backgroundOpacityValueDisplay.textContent = `${Math.round(backgroundOpacitySlider.value * 100)}%`;
            // A atualização da preview já é pega pelo listener de input geral
        });
    }
    
    const logoFilenameInput = document.getElementById('logo-filename-input');
    if (logoFilenameInput && logoPreviewImg) {
        logoFilenameInput.addEventListener('change', () => { // 'change' é melhor para file path
            const filename = logoFilenameInput.value.trim();
            logoPreviewImg.src = filename ? `assets/${filename}` : DEFAULT_LOGO_SRC;
            // A atualização da preview e dirty check já são pegos
        });
    }
    const restoreDefaultLogoBtn = document.getElementById('restore-default-logo-btn');
    if(restoreDefaultLogoBtn && logoFilenameInput && logoPreviewImg) {
        restoreDefaultLogoBtn.addEventListener('click', () => {
            logoFilenameInput.value = DEFAULT_CUSTOMIZATIONS.visualIdentity.logoFileName || '';
            logoPreviewImg.src = DEFAULT_LOGO_SRC;
            localCheckDirtyState('customizations');
            debouncedUpdatePreview(currentPreviewScreen);
        });
    }

    const restoreDefaultBackgroundBtn = document.getElementById('restore-default-background-btn');
    if (restoreDefaultBackgroundBtn) {
        restoreDefaultBackgroundBtn.addEventListener('click', () => {
            const bgFilenameEl = document.getElementById('background-filename-input');
            const enableCustomBgEl = document.getElementById('enable-custom-background');
            const bgOpacityEl = document.getElementById('custom-backgroundOpacity');

            if (bgFilenameEl) bgFilenameEl.value = DEFAULT_CUSTOMIZATIONS.visualIdentity.customBackgroundFileName;
            if (enableCustomBgEl) enableCustomBgEl.checked = DEFAULT_CUSTOMIZATIONS.visualIdentity.enableCustomBackground;
            if (bgOpacityEl) {
                bgOpacityEl.value = DEFAULT_CUSTOMIZATIONS.visualIdentity.customBackgroundOpacity;
                 if (backgroundOpacityValueDisplay) backgroundOpacityValueDisplay.textContent = `${Math.round(bgOpacityEl.value * 100)}%`;
            }
            localCheckDirtyState('customizations');
            debouncedUpdatePreview(currentPreviewScreen);
        });
    }


    initializeAccordions();
    initializePreviewSystem();
    populateThemesGallery(); // Popula a galeria de temas
    _loadAdminCustomizationsToUI(); // Carrega os dados e atualiza a preview
    
    if (customizationStatusMessageEl) customizationStatusMessageEl.textContent = '';

    return {
        save: _saveQuizCustomizationsHandler,
        reset: () => { 
            _loadAdminCustomizationsToUI(); 
            debouncedUpdatePreview(currentPreviewScreen);
        },
        getCustomizationsFormData: _getCustomizationsFormDataFromDOM
    };
}