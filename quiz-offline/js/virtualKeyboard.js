// js/virtualKeyboard.js
import { MIN_KEYBOARD_HEIGHT_VH, MAX_KEYBOARD_HEIGHT_VH, DEFAULT_KEYBOARD_HEIGHT_VH } from './constants.js';

let virtualKeyboardEl;
let keyboardTargetInputEl = null;
let isResizingKeyboard = false;
let initialKeyboardHeightVh;
let initialPointerY;
let keyboardResizeHandleEl;

let currentSettings = {}; // Para armazenar a referência das configurações
let resetIdleTimerCallback = () => {}; // Callback para resetar o idle timer

/**
 * Inicializa o módulo do teclado virtual.
 * @param {object} settingsRef - Referência ao objeto de configurações do quiz.
 * @param {function} resetIdleCb - Callback para a função resetIdleTimer.
 */
export function initVirtualKeyboard(settingsRef, resetIdleCb) {
    console.log("VKB: initVirtualKeyboard - (Restaurado) Iniciando teclado virtual...");
    virtualKeyboardEl = document.getElementById('virtual-keyboard');
    currentSettings = settingsRef;
    resetIdleTimerCallback = resetIdleCb;

    if (!virtualKeyboardEl) {
        console.warn("VKB: initVirtualKeyboard - (Restaurado) Elemento #virtual-keyboard não encontrado no DOM.");
        return; // Adicionado retorno para evitar erros se o elemento não existir
    }
    // Removido: virtualKeyboardEl.style.position = 'relative';
    // O CSS deve controlar o posicionamento fixo do teclado.
    // A alça de redimensionamento (position:absolute) será relativa ao teclado (position:fixed).

    console.log("VKB: initVirtualKeyboard - (Restaurado) Chamando createKeyboardResizeHandle...");
    createKeyboardResizeHandle(); 
    if (keyboardResizeHandleEl) {
        console.log("VKB: initVirtualKeyboard - (Restaurado) keyboardResizeHandleEl referenciado com sucesso.");
    } else {
        console.warn("VKB: initVirtualKeyboard - (Restaurado) keyboardResizeHandleEl NÃO foi referenciado após createKeyboardResizeHandle.");
    }
}

/**
 * Aplica a altura do teclado virtual e ajusta o tamanho da fonte das teclas.
 * @param {number|string} targetHeightVh - A altura desejada para o teclado em vh.
 */
export function applyVirtualKeyboardHeight(targetHeightVh) {
    if (!virtualKeyboardEl) {
        console.warn("VKB: applyVirtualKeyboardHeight - virtualKeyboardEl não definido.");
        return;
    }

    const currentKeyboardHeightVh = parseFloat(targetHeightVh);
    if (isNaN(currentKeyboardHeightVh)) {
        console.warn("VKB: applyVirtualKeyboardHeight - targetHeightVh inválido:", targetHeightVh);
        return;
    }

    const clampedHeightVh = Math.max(MIN_KEYBOARD_HEIGHT_VH, Math.min(MAX_KEYBOARD_HEIGHT_VH, currentKeyboardHeightVh));
    virtualKeyboardEl.style.height = `${clampedHeightVh}vh`;

    const keyboardHeightPx = (clampedHeightVh / 100) * window.innerHeight;
    const baseFontSizePx = keyboardHeightPx * 0.08; 
    const minFontSizePx = 14;
    const maxFontSizePx = 32; 
    const finalFontSizePx = Math.max(minFontSizePx, Math.min(maxFontSizePx, baseFontSizePx));

    document.documentElement.style.setProperty('--virtual-keyboard-key-font-size', `${finalFontSizePx}px`);
}

/**
 * Cria o manipulador de redimensionamento para o teclado virtual.
 */
export function createKeyboardResizeHandle() {
    if (!virtualKeyboardEl) {
        console.warn("VKB: createKeyboardResizeHandle - (Restaurado) virtualKeyboardEl não encontrado.");
        return;
    }
    // Remove qualquer alça existente para evitar duplicatas ao reiniciar
    const existingOldHandle = document.getElementById('keyboard-resize-handle');
    if (existingOldHandle) {
        existingOldHandle.remove();
    }

    keyboardResizeHandleEl = document.createElement('div');
    keyboardResizeHandleEl.id = 'keyboard-resize-handle';
    // Estilos são aplicados via CSS (style.css #keyboard-resize-handle)
    virtualKeyboardEl.prepend(keyboardResizeHandleEl);
    console.log("VKB: createKeyboardResizeHandle - (Restaurado) Nova alça prepended ao virtualKeyboardEl.");
    
    keyboardResizeHandleEl.removeEventListener('mousedown', startKeyboardResize); // Previne duplicatas
    keyboardResizeHandleEl.removeEventListener('touchstart', startKeyboardResize); // Previne duplicatas

    keyboardResizeHandleEl.addEventListener('mousedown', startKeyboardResize);
    keyboardResizeHandleEl.addEventListener('touchstart', startKeyboardResize, { passive: false });
    console.log("VKB: createKeyboardResizeHandle - (Restaurado) Listeners de mousedown e touchstart adicionados.");
}

function startKeyboardResize(event) {
    if (!virtualKeyboardEl || !keyboardResizeHandleEl) return;
    if (event.type === 'touchstart') event.preventDefault();
    isResizingKeyboard = true;
    initialPointerY = event.type === 'touchstart' ? event.touches[0].clientY : event.clientY;

    const currentHeightStyle = virtualKeyboardEl.style.height;
    if (currentHeightStyle && currentHeightStyle.endsWith('vh')) {
        initialKeyboardHeightVh = parseFloat(currentHeightStyle);
    } else {
        initialKeyboardHeightVh = currentSettings.virtualKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH;
    }

    virtualKeyboardEl.classList.add('resizing');
    if(keyboardResizeHandleEl) keyboardResizeHandleEl.classList.add('resizing');


    document.addEventListener('mousemove', doKeyboardResize);
    document.addEventListener('touchmove', doKeyboardResize, { passive: false });
    document.addEventListener('mouseup', stopKeyboardResize);
    document.addEventListener('touchend', stopKeyboardResize);
}

function doKeyboardResize(event) {
    if (!isResizingKeyboard || !virtualKeyboardEl) return;
    if (event.type === 'touchmove') event.preventDefault();

    const currentPointerY = event.type === 'touchmove' ? event.touches[0].clientY : event.clientY;
    const deltaY = currentPointerY - initialPointerY;
    const deltaVh = (deltaY / window.innerHeight) * 100;
    let newHeightVh = initialKeyboardHeightVh - deltaVh;

    applyVirtualKeyboardHeight(newHeightVh);
}

function stopKeyboardResize() {
    if (!isResizingKeyboard) return;
    isResizingKeyboard = false;
    if (virtualKeyboardEl) virtualKeyboardEl.classList.remove('resizing');
    if (keyboardResizeHandleEl) keyboardResizeHandleEl.classList.remove('resizing');


    document.removeEventListener('mousemove', doKeyboardResize);
    document.removeEventListener('touchmove', doKeyboardResize);
    document.removeEventListener('mouseup', stopKeyboardResize);
    document.removeEventListener('touchend', stopKeyboardResize);

    if (virtualKeyboardEl && virtualKeyboardEl.style.height) {
        const newHeight = parseFloat(virtualKeyboardEl.style.height);
        if (!isNaN(newHeight) && typeof currentSettings === 'object' && currentSettings !== null) {
            currentSettings.virtualKeyboardHeight = newHeight;
        }
    }
}

/**
 * Cria e popula o teclado virtual com teclas.
 */
export function createVirtualKeyboard() {
    if (!virtualKeyboardEl || !keyboardTargetInputEl) {
        if (virtualKeyboardEl) virtualKeyboardEl.classList.add('hidden');
        return;
    }
    
    // Remover apenas as teclas existentes para preservar a alça
    const existingKeys = virtualKeyboardEl.querySelectorAll('.virtual-key');
    existingKeys.forEach(key => key.remove());

    let layout;
    if (keyboardTargetInputEl.id === 'telefone') {
        layout = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['Backspace', '0', 'OK']];
        virtualKeyboardEl.style.gridTemplateColumns = 'repeat(3, 1fr)';
    } else { 
        layout = [['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
                 ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç'],
                 ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
                 ['Space', 'OK']];
        virtualKeyboardEl.style.gridTemplateColumns = `repeat(10, 1fr)`;
    }

    layout.forEach((row, rowIndex) => {
        row.forEach(key => {
            const keyElement = document.createElement('button');
            if (key === 'Space') {
                keyElement.textContent = 'ESPAÇO';
            } else if (key === 'Backspace') {
                keyElement.textContent = 'APAGAR';
            } else {
                keyElement.textContent = key;
            }
            keyElement.classList.add('virtual-key');

            if (key === 'Backspace') keyElement.classList.add('key-backspace');
            if (key === 'Space') keyElement.classList.add('key-space');
            if (key === 'OK') keyElement.classList.add('ok-key-highlight');

            if (keyboardTargetInputEl.id === 'nome') { // Aplica spans para layout 'nome'
                if (key === 'Backspace' && rowIndex === 2) { 
                    keyElement.style.gridColumn = 'span 3';
                } else if (key === 'Space' && rowIndex === 3) { 
                    keyElement.style.gridColumn = 'span 7';
                } else if (key === 'OK' && rowIndex === 3) { 
                    keyElement.style.gridColumn = 'span 3';
                }
            }
            keyElement.addEventListener('click', () => onVirtualKeyPress(key));
            virtualKeyboardEl.appendChild(keyElement);
        });
    });

    virtualKeyboardEl.style.display = 'grid';
    virtualKeyboardEl.classList.remove('hidden');
    
    if (keyboardResizeHandleEl && currentSettings.enableVirtualKeyboard) {
        keyboardResizeHandleEl.classList.remove('hidden');
        keyboardResizeHandleEl.style.cssText = ''; // Garante que estilos de diagnóstico sejam limpos
    } else if (keyboardResizeHandleEl) {
        keyboardResizeHandleEl.classList.add('hidden');
    }
}

function onVirtualKeyPress(key) {
    if (!keyboardTargetInputEl) return;

    switch (key) {
        case 'Backspace': 
            keyboardTargetInputEl.value = keyboardTargetInputEl.value.slice(0, -1);
            break;
        case 'Space': 
            if (keyboardTargetInputEl.id === 'nome') { 
                keyboardTargetInputEl.value += ' ';
            }
            break;
        case 'OK':
            hideVirtualKeyboard(); 
            if (keyboardTargetInputEl) keyboardTargetInputEl.blur(); 
            break;
        default:
            keyboardTargetInputEl.value += key;
    }
    if (keyboardTargetInputEl) keyboardTargetInputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    resetIdleTimerCallback();
}

/**
 * Mostra o teclado virtual para um elemento de input específico.
 * @param {HTMLInputElement} targetElement - O elemento de input que receberá o texto.
 */
export function showVirtualKeyboard(targetElement) { // Não aceita layoutName nesta versão
    if (!virtualKeyboardEl) {
        console.warn("VKB: showVirtualKeyboard - (Restaurado) Elemento do teclado não encontrado.");
        return;
    }
    if (currentSettings.enableVirtualKeyboard === false) {
        console.log("VKB: showVirtualKeyboard - (Restaurado) Teclado desabilitado nas configs.");
        virtualKeyboardEl.classList.add('hidden');
        if (keyboardResizeHandleEl) keyboardResizeHandleEl.classList.add('hidden');
        return;
    }

    keyboardTargetInputEl = targetElement;
    createVirtualKeyboard(); 
    resetIdleTimerCallback();
}

/**
 * Esconde o teclado virtual.
 */
export function hideVirtualKeyboard() {
    if (!virtualKeyboardEl) return;
    virtualKeyboardEl.classList.add('hidden');
    if (keyboardResizeHandleEl) keyboardResizeHandleEl.classList.add('hidden'); 
    keyboardTargetInputEl = null; 
}

/**
 * Retorna se o teclado está em processo de redimensionamento.
 * @returns {boolean}
 */
export function getIsResizingKeyboard() {
    return isResizingKeyboard;
}