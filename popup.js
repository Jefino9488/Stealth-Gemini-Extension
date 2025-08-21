// Popup script for handling user interactions
document.addEventListener('DOMContentLoaded', function() {
    const questionInput = document.getElementById('questionInput');
    const submitBtn = document.getElementById('submitBtn');
    const clearBtn = document.getElementById('clearBtn');
    const responseDiv = document.getElementById('response');
    const useContextCheckbox = document.getElementById('useContextCheckbox');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const systemPromptInput = document.getElementById('systemPromptInput');
    const transparencySlider = document.getElementById('transparencySlider');
    const transparencyValue = document.getElementById('transparencyValue');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');

    let isSettingsVisible = false;
    let originalSettings = {};

    // Load saved settings
    chrome.runtime.sendMessage({ type: 'getSettings' }, (response) => {
        if (chrome.runtime.lastError) {
            console.log('Error getting settings:', chrome.runtime.lastError);
            return;
        }
        if (response) {
            originalSettings = { ...response };

            if (response.apiKey) {
                apiKeyInput.value = response.apiKey;
            }
            if (response.systemPrompt) {
                systemPromptInput.value = response.systemPrompt;
            } else {
                systemPromptInput.value = 'You are a helpful AI assistant specialized in answering quiz questions, forms, and academic content. Provide accurate, concise answers.';
            }
            if (response.transparency !== undefined) {
                transparencySlider.value = response.transparency;
                transparencyValue.textContent = Math.round(response.transparency * 100) + '%';
            }
        }
    });

    // Focus on input when popup opens
    setTimeout(() => questionInput.focus(), 100);

    // Handle submit button click
    submitBtn.addEventListener('click', handleSubmit);

    // Handle Enter key in textarea
    questionInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    });

    // Handle clear button
    clearBtn.addEventListener('click', function() {
        questionInput.value = '';
        responseDiv.style.display = 'none';
        questionInput.focus();
    });

    // Handle settings button
    settingsBtn.addEventListener('click', function() {
        isSettingsVisible = !isSettingsVisible;
        settingsPanel.style.display = isSettingsVisible ? 'block' : 'none';
        if (isSettingsVisible) {
            apiKeyInput.focus();
        }
    });

    // Handle settings save
    saveSettingsBtn.addEventListener('click', function() {
        const apiKey = apiKeyInput.value.trim();
        const systemPrompt = systemPromptInput.value.trim();
        const transparency = parseFloat(transparencySlider.value);

        if (!apiKey) {
            showResponse('Please enter an API key', true);
            return;
        }

        if (!systemPrompt) {
            showResponse('Please enter a system prompt', true);
            return;
        }

        chrome.runtime.sendMessage({
            type: 'saveSettings',
            settings: {
                apiKey: apiKey,
                systemPrompt: systemPrompt,
                transparency: transparency
            }
        }, (response) => {
            if (chrome.runtime.lastError) {
                showResponse('Error saving settings: ' + chrome.runtime.lastError.message, true);
                return;
            }

            if (response && response.success) {
                // Close settings panel
                settingsPanel.style.display = 'none';
                isSettingsVisible = false;

                // Update original settings
                originalSettings = {
                    apiKey: apiKey,
                    systemPrompt: systemPrompt,
                    transparency: transparency
                };

                showResponse('Settings saved successfully!', false);

                // Auto-hide success message after 2 seconds
                setTimeout(() => {
                    if (responseDiv.textContent === 'Settings saved successfully!') {
                        responseDiv.style.display = 'none';
                    }
                }, 2000);
            } else {
                showResponse('Failed to save settings', true);
            }
        });
    });

    // Handle settings cancel
    cancelSettingsBtn.addEventListener('click', function() {
        // Restore original settings
        apiKeyInput.value = originalSettings.apiKey || '';
        systemPromptInput.value = originalSettings.systemPrompt || 'You are a helpful AI assistant specialized in answering quiz questions, forms, and academic content. Provide accurate, concise answers.';
        transparencySlider.value = originalSettings.transparency || 0.95;
        transparencyValue.textContent = Math.round((originalSettings.transparency || 0.95) * 100) + '%';

        // Close settings panel
        settingsPanel.style.display = 'none';
        isSettingsVisible = false;
    });

    // Handle Enter key in API key input
    apiKeyInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveSettingsBtn.click();
        }
    });

    // Handle Ctrl+Enter in system prompt textarea
    systemPromptInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            saveSettingsBtn.click();
        }
    });

    // Handle transparency slider
    transparencySlider.addEventListener('input', function() {
        const value = parseFloat(this.value);
        transparencyValue.textContent = Math.round(value * 100) + '%';
    });

    function handleSubmit() {
        const question = questionInput.value.trim();
        if (!question) return;

        setLoading(true);

        // Use a timeout to handle cases where the service worker doesn't respond
        const messageTimeout = setTimeout(() => {
            setLoading(false);
            showResponse('Request timeout. Please try again.', true);
        }, 30000); // 30 second timeout

        chrome.runtime.sendMessage({
            type: 'askGemini',
            question: question,
            useContext: useContextCheckbox.checked
        }, function(response) {
            clearTimeout(messageTimeout);
            setLoading(false);

            if (chrome.runtime.lastError) {
                console.log('Runtime error:', chrome.runtime.lastError);
                showResponse('Connection error: ' + chrome.runtime.lastError.message, true);
                return;
            }

            if (!response) {
                showResponse('No response received from background script', true);
                return;
            }

            if (response.error) {
                showResponse(response.error, true);
            } else {
                showResponse(response.response, false);
            }
        });
    }

    function setLoading(isLoading) {
        submitBtn.disabled = isLoading;

        if (isLoading) {
            submitBtn.innerHTML = '<div class="spinner"></div>';
            responseDiv.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
            responseDiv.style.display = 'block';
        } else {
            submitBtn.textContent = 'Ask Gemini';
        }
    }

    function showResponse(message, isError) {
        responseDiv.className = isError ? 'response error' : 'response';
        responseDiv.textContent = message;
        responseDiv.style.display = 'block';

        // Auto-scroll to show response
        responseDiv.scrollTop = responseDiv.scrollHeight;
    }

    // Close settings panel when clicking outside (if implemented in future)
    document.addEventListener('click', function(e) {
        // This would close settings if clicking outside, but might be too aggressive for a popup
        // Leaving commented for now
        /*
        if (isSettingsVisible && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
            cancelSettingsBtn.click();
        }
        */
    });
});