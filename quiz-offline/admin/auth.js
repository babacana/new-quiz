import { showAlert } from '../js/utils.js'; // Ajuste no caminho

const ADMIN_PASSWORD = "CAESB2025!";

let adminPasswordInput, adminLoginBtn, adminLoginErrorEl, adminLogoutIconBtn;
let callbacks = {};

function handleLogin() {
    if (adminPasswordInput.value === ADMIN_PASSWORD) {
        adminPasswordInput.value = '';
        if (adminLoginErrorEl) adminLoginErrorEl.classList.add('hidden');
        if (callbacks.loadAdminDataAndUpdateUI) callbacks.loadAdminDataAndUpdateUI();
        if (callbacks.proceedWithShowScreen) callbacks.proceedWithShowScreen('admin-dashboard-screen');
    } else {
        if (adminLoginErrorEl) {
            adminLoginErrorEl.classList.remove('hidden');
            adminLoginErrorEl.textContent = 'Senha incorreta. Tente novamente.';
        }
    }
}

function handleLogout() {
    if (adminLoginErrorEl) adminLoginErrorEl.classList.add('hidden');
    // attemptNavigation é mais complexo devido ao 'dirty state',
    // por isso é passado como callback.
    if (callbacks.attemptNavigation) callbacks.attemptNavigation('admin-login-screen');
}

export function initAuth(cbObject) {
    callbacks = cbObject; // Armazena os callbacks recebidos

    adminPasswordInput = document.getElementById('admin-password');
    adminLoginBtn = document.getElementById('admin-login-btn');
    adminLoginErrorEl = document.getElementById('admin-login-error');
    adminLogoutIconBtn = document.getElementById('admin-logout-icon-btn');

    if (adminLoginBtn && adminPasswordInput && adminLoginErrorEl) {
        adminLoginBtn.addEventListener('click', handleLogin);
        adminPasswordInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleLogin();
            }
        });
    } else {
        console.error("Auth: Elementos de login não encontrados.");
    }

    if (adminLogoutIconBtn) {
        adminLogoutIconBtn.addEventListener('click', handleLogout);
    } else {
        console.error("Auth: Botão de logout não encontrado.");
    }
}