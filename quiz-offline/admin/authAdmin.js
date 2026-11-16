// admin/authAdmin.js

// TODO: Considerar uma forma mais segura de gerenciar a senha em um ambiente de produção.
const ADMIN_PASSWORD = 'CAESB2025!'; // Senha placeholder

export function initializeAuthEventListeners(
    adminLoginBtn,
    adminPasswordInput,
    adminLoginErrorEl,
    loadAdminDataAndUpdateUI,
    handleNavigationWithDirtyCheck
) {
    if (adminLoginBtn && adminPasswordInput && adminLoginErrorEl) {
        adminLoginBtn.addEventListener('click', () => {
            if (adminPasswordInput.value === ADMIN_PASSWORD) {
                adminPasswordInput.value = '';
                if (adminLoginErrorEl) adminLoginErrorEl.classList.add('hidden');
                loadAdminDataAndUpdateUI();
                // Força a navegação para o dashboard após o login bem-sucedido
                handleNavigationWithDirtyCheck('admin-dashboard-screen', 'showScreen', true);
            } else {
                if (adminLoginErrorEl) {
                    adminLoginErrorEl.classList.remove('hidden');
                    adminLoginErrorEl.textContent = 'Senha incorreta. Tente novamente.';
                }
            }
        });

        adminPasswordInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                adminLoginBtn.click(); // Simula o clique no botão de login
            }
        });
    }
}