// Aggressive content script override - completely replaces any existing version
(function() {
    'use strict';

    // Force cleanup of any existing instances
    if (window.geminiExtensionCleanup) {
        try {
            window.geminiExtensionCleanup();
        } catch (e) {}
    }

    // Remove any existing elements
    try {
        const existingIcons = document.querySelectorAll('[data-gemini-analyze-icon]');
        existingIcons.forEach(icon => icon.remove());

        const existingMessages = document.querySelectorAll('[data-gemini-message-box]');
        existingMessages.forEach(msg => msg.remove());

        const existingStyles = document.getElementById('gemini-analyze-styles');
        if (existingStyles) existingStyles.remove();
    } catch (e) {}

    // Set loaded flag
    window.geminiContentScriptLoaded = true;

    let messageBox = null;
    let analyzeIcon = null;
    let currentSelection = null;
    let extensionActive = true;
    let contextCheckInterval = null;
    let pendingAnalysis = false;
    let lastSelectionAt = 0;

    // Safe chrome runtime check
    function isChromeRuntimeAvailable() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.sendMessage);
        } catch (e) {
            return false;
        }
    }

    // Check if extension context is still valid
    function checkExtensionContext() {
        if (!extensionActive || !isChromeRuntimeAvailable()) {
            extensionActive = false;
            cleanup();
            return;
        }

        try {
            chrome.runtime.sendMessage({type: 'ping'}, (response) => {
                if (chrome.runtime.lastError || !response) {
                    console.log('Extension context lost, reinitializing...');
                    // Don't cleanup completely, just reinitialize
                    extensionActive = true;
                    setTimeout(initialize, 1000);
                }
            });
        } catch (error) {
            console.log('Context check failed, reinitializing...');
            extensionActive = true;
            setTimeout(initialize, 1000);
        }
    }

    // Comprehensive cleanup function
    function cleanup() {
        console.log('Cleaning up Gemini extension...');

        // Clear interval
        if (contextCheckInterval) {
            clearInterval(contextCheckInterval);
            contextCheckInterval = null;
        }

        // Remove UI elements
        if (analyzeIcon) {
            try {
                analyzeIcon.remove();
            } catch (e) {}
            analyzeIcon = null;
        }

        if (messageBox) {
            try {
                messageBox.remove();
            } catch (e) {}
            messageBox = null;
        }

        // Remove event listeners safely
        try {
            document.removeEventListener('mouseup', handleTextSelection, true);
            document.removeEventListener('selectionchange', handleSelectionChange);
            document.removeEventListener('click', handleDocumentClick);
            document.removeEventListener('scroll', hideAnalyzeIcon);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', hideAnalyzeIcon);
            window.removeEventListener('beforeunload', cleanup);

            // Clear any pending timeouts
            if (window.geminiSelectionTimeout) {
                clearTimeout(window.geminiSelectionTimeout);
            }
        } catch (e) {}

        extensionActive = false;

        // Clear global flag to allow reinitialization
        delete window.geminiContentScriptLoaded;
    }

    // Set global cleanup function
    window.geminiExtensionCleanup = cleanup;

    // Safe event listener addition
    function addEventListeners() {
        if (!extensionActive) return;

        try {
            document.addEventListener('mouseup', handleTextSelection, true);
            document.addEventListener('selectionchange', handleSelectionChange);
            document.addEventListener('click', handleDocumentClick);
            document.addEventListener('scroll', hideAnalyzeIcon, { passive: true });
            window.addEventListener('blur', hideAnalyzeIcon);
            window.addEventListener('beforeunload', cleanup);
            document.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('keyup', handleKeyUp);
        } catch (e) {
            console.log('Failed to add event listeners:', e);
        }
    }

    function handleMouseDown(e) {
        if (!extensionActive) return;
        if (e.detail === 1) {
            setTimeout(() => {
                const selection = window.getSelection();
                if (!selection || selection.toString().trim().length === 0) {
                    hideAnalyzeIcon();
                }
            }, 10);
        }
    }

    function handleKeyUp(e) {
        if (!extensionActive) return;

        if (e.ctrlKey || e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {

            setTimeout(() => {
                try {
                    const selection = window.getSelection();
                    const selectedText = selection ? selection.toString().trim() : '';

                    if (selectedText.length > 0) {
                        const range = selection.getRangeAt(0);
                        const rect = range.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            lastSelectionAt = Date.now();
                            showAnalyzeIcon(rect.right + 10, rect.top - 30, selectedText);
                        }
                    } else {
                        hideAnalyzeIcon();
                    }
                } catch (error) {
                    console.log('Error in handleKeyUp:', error);
                }
            }, 100);
        }
    }

    function handleTextSelection(e) {
        if (!extensionActive || !isChromeRuntimeAvailable()) {
            return;
        }

        setTimeout(() => checkSelectionAndShowIcon(e), 10);
        setTimeout(() => checkSelectionAndShowIcon(e), 100);
        setTimeout(() => checkSelectionAndShowIcon(e), 200);
    }

    function checkSelectionAndShowIcon(e) {
        try {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';

            if (selectedText.length > 0) {
                lastSelectionAt = Date.now();
                if (!analyzeIcon || currentSelection !== selectedText) {
                    showAnalyzeIcon(e.pageX, e.pageY, selectedText);
                }
            } else if (selectedText.length === 0 && analyzeIcon) {
                hideAnalyzeIcon();
            }
        } catch (error) {
            console.log('Error in checkSelectionAndShowIcon:', error);
        }
    }

    function handleSelectionChange() {
        if (!extensionActive) return;

        clearTimeout(window.geminiSelectionTimeout);
        window.geminiSelectionTimeout = setTimeout(() => {
            try {
                const selection = window.getSelection();
                const selectedText = selection ? selection.toString().trim() : '';

                if (selectedText.length === 0 && analyzeIcon) {
                    hideAnalyzeIcon();
                }
            } catch (error) {
                console.log('Error in handleSelectionChange:', error);
            }
        }, 100);
    }

    function handleDocumentClick(e) {
        if (!extensionActive) return;

        if (Date.now() - lastSelectionAt < 350) return;

        try {
            const selection = window.getSelection();
            const hasSelection = selection && selection.toString().trim().length > 0;
            if (hasSelection) return;
        } catch (err) {}

        const clickedInsideIcon = analyzeIcon && analyzeIcon.contains(e.target);
        const clickedInsideMsg = messageBox && messageBox.contains(e.target);
        if (analyzeIcon && !clickedInsideIcon && !clickedInsideMsg) {
            setTimeout(hideAnalyzeIcon, 100);
        }
    }

    function showAnalyzeIcon(x, y, selectedText) {
        if (!extensionActive || !isChromeRuntimeAvailable()) {
            return;
        }

        try {
            hideAnalyzeIcon();
            currentSelection = selectedText;

            analyzeIcon = document.createElement('div');
            analyzeIcon.setAttribute('data-gemini-analyze-icon', 'true');
            analyzeIcon.innerHTML = '🧠';
            analyzeIcon.title = 'Analyze with Gemini';
            analyzeIcon.style.cssText = `
                position: absolute;
                left: ${x + 10}px;
                top: ${y - 30}px;
                width: 32px;
                height: 32px;
                background: #4285f4;
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 999998;
                font-size: 16px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                border: 2px solid white;
                animation: fadeInScale 0.2s ease-out;
                user-select: none;
                pointer-events: auto;
            `;

            if (!document.getElementById('gemini-analyze-styles')) {
                const style = document.createElement('style');
                style.id = 'gemini-analyze-styles';
                style.textContent = `
                    @keyframes fadeInScale {
                        0% { opacity: 0; transform: scale(0.5); }
                        100% { opacity: 1; transform: scale(1); }
                    }
                    .gemini-icon-hover {
                        transform: scale(1.1) !important;
                        background: #3367d6 !important;
                    }
                `;
                document.head.appendChild(style);
            }

            analyzeIcon.addEventListener('mouseenter', () => {
                try {
                    if (analyzeIcon) analyzeIcon.classList.add('gemini-icon-hover');
                } catch (e) {}
            });

            analyzeIcon.addEventListener('mouseleave', () => {
                try {
                    if (analyzeIcon) analyzeIcon.classList.remove('gemini-icon-hover');
                } catch (e) {}
            });

            analyzeIcon.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!extensionActive || !isChromeRuntimeAvailable() || pendingAnalysis) {
                    return;
                }

                if (pendingAnalysis) {
                    return;
                }

                pendingAnalysis = true;

                let textToAnalyze = currentSelection;
                if (!textToAnalyze) {
                    const selection = window.getSelection();
                    textToAnalyze = selection ? selection.toString().trim() : '';
                }

                if (!textToAnalyze) {
                    pendingAnalysis = false;
                    hideAnalyzeIcon();
                    return;
                }

                // Show loading state
                if (analyzeIcon) {
                    analyzeIcon.innerHTML = '⏳';
                    analyzeIcon.style.background = '#ff9800';
                }

                const timeoutId = setTimeout(() => {
                    pendingAnalysis = false;
                    if (analyzeIcon) {
                        analyzeIcon.innerHTML = '❌';
                        analyzeIcon.style.background = '#f44336';
                        setTimeout(() => {
                            if (analyzeIcon) {
                                analyzeIcon.innerHTML = '🧠';
                                analyzeIcon.style.background = '#4285f4';
                            }
                        }, 1000);
                    }
                }, 10000);

                try {
                    chrome.runtime.sendMessage({
                        type: 'analyzeText',
                        text: textToAnalyze
                    }, (response) => {
                        clearTimeout(timeoutId);
                        pendingAnalysis = false;

                        if (chrome.runtime.lastError) {
                            console.log('Runtime error:', chrome.runtime.lastError.message);
                            if (analyzeIcon) {
                                analyzeIcon.innerHTML = '❌';
                                analyzeIcon.style.background = '#f44336';
                                setTimeout(() => {
                                    if (analyzeIcon) {
                                        analyzeIcon.innerHTML = '🧠';
                                        analyzeIcon.style.background = '#4285f4';
                                    }
                                }, 1000);
                            }
                        } else {
                            // Reset icon to ready state
                            if (analyzeIcon) {
                                analyzeIcon.innerHTML = '🧠';
                                analyzeIcon.style.background = '#4285f4';
                            }
                        }
                    });
                } catch (error) {
                    clearTimeout(timeoutId);
                    pendingAnalysis = false;
                    console.log('Failed to send message:', error);

                    if (analyzeIcon) {
                        analyzeIcon.innerHTML = '❌';
                        analyzeIcon.style.background = '#f44336';
                        setTimeout(() => {
                            if (analyzeIcon) {
                                analyzeIcon.innerHTML = '🧠';
                                analyzeIcon.style.background = '#4285f4';
                            }
                        }, 1000);
                    }
                }
            });

            // Auto-hide after 10 seconds
            setTimeout(() => {
                if (analyzeIcon && analyzeIcon.parentNode && extensionActive && !pendingAnalysis) {
                    hideAnalyzeIcon();
                }
            }, 10000);

            if (document.body) {
                document.body.appendChild(analyzeIcon);
            }
        } catch (error) {
            console.log('Error in showAnalyzeIcon:', error);
        }
    }

    function hideAnalyzeIcon() {
        if (analyzeIcon) {
            try {
                analyzeIcon.remove();
            } catch (e) {}
            analyzeIcon = null;
        }
        currentSelection = null;
    }

    // Message listener with comprehensive error handling
    if (isChromeRuntimeAvailable()) {
        try {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (!extensionActive) {
                    sendResponse({error: 'Extension inactive'});
                    return;
                }

                try {
                    switch (request.type) {
                        case 'ping':
                            sendResponse({pong: true});
                            break;

                        case 'showResponse':
                            showFloatingMessage(request.data, false, request.transparency || 0.95);
                            sendResponse({success: true});
                            break;

                        case 'showError':
                            showFloatingMessage(request.data, true, request.transparency || 0.95);
                            sendResponse({success: true});
                            break;

                        case 'copyToClipboard':
                            copyToClipboard(request.data, request.transparency || 0.95);
                            sendResponse({success: true});
                            break;

                        case 'promptApiKey':
                            promptForApiKey().then(apiKey => {
                                sendResponse({ apiKey: apiKey });
                            }).catch(error => {
                                sendResponse({ error: error.message });
                            });
                            return true;

                        case 'analyzeComplete':
                            showFloatingMessage(request.data, false, request.transparency || 0.95);
                            sendResponse({success: true});
                            break;

                        case 'analyzeError':
                            showFloatingMessage(request.data, true, request.transparency || 0.95);
                            sendResponse({success: true});
                            break;

                        case 'getPageContext':
                            const context = getPageContext();
                            sendResponse({ context: context });
                            break;

                        default:
                            sendResponse({error: 'Unknown message type'});
                    }
                } catch (error) {
                    console.log('Error handling message:', error);
                    sendResponse({error: 'Message handling failed'});
                }
            });
        } catch (error) {
            console.log('Failed to add message listener:', error);
        }
    }

    function getPageContext() {
        try {
            let context = '';
            const title = document.title;
            if (title) context += `Page Title: ${title}\n\n`;

            const contentSelectors = [
                'main', '[role="main"]', '.main-content', '.content',
                '#content', '#main', 'article', '.post-content',
                '.entry-content', '.page-content'
            ];

            let mainContent = '';
            for (const selector of contentSelectors) {
                const element = document.querySelector(selector);
                if (element && element.innerText) {
                    mainContent = element.innerText;
                    break;
                }
            }

            if (!mainContent && document.body) {
                mainContent = document.body.innerText || '';
            }

            if (mainContent) {
                mainContent = mainContent.replace(/\s+/g, ' ').trim();
                if (mainContent.length > 3000) {
                    mainContent = mainContent.substring(0, 3000) + '...';
                }
                context += `Page Content:\n${mainContent}`;
            }

            context += `\n\nPage URL: ${window.location.href.split('?')[0]}`;
            return context;
        } catch (error) {
            console.log('Error extracting page context:', error);
            return `Page Title: ${document.title || 'Unknown'}\nURL: ${window.location.href}`;
        }
    }

    function showFloatingMessage(message, isError = false, transparency = 0.95) {
        try {
            // Close any existing message
            if (messageBox) {
                messageBox.remove();
                messageBox = null;
            }

            messageBox = document.createElement('div');
            messageBox.setAttribute('data-gemini-message-box', 'true');
            messageBox.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 400px;
                padding: 16px;
                background: ${isError ? '#fee' : '#f9f9f9'};
                border: 1px solid ${isError ? '#fcc' : '#ddd'};
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                line-height: 1.5;
                color: ${isError ? '#c00' : '#333'};
                cursor: move;
                opacity: ${transparency};
                user-select: text;
                pointer-events: auto;
            `;

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = `
                position: absolute;
                top: 4px;
                right: 8px;
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: #999;
                padding: 0;
                width: 20px;
                height: 20px;
                line-height: 1;
            `;
            closeBtn.onclick = () => {
                if (messageBox) messageBox.remove();
                messageBox = null;
            };

            const content = document.createElement('div');
            content.style.paddingRight = '24px';
            content.textContent = message;

            messageBox.appendChild(closeBtn);
            messageBox.appendChild(content);

            if (document.body) {
                document.body.appendChild(messageBox);
            }

            // Auto-close after 4 seconds (3-5 seconds as requested)
            setTimeout(() => {
                if (messageBox && messageBox.parentNode) {
                    messageBox.remove();
                    messageBox = null;
                }
            }, 4000); // 4 seconds auto-close

        } catch (error) {
            console.log('Error showing floating message:', error);
        }
    }

    async function copyToClipboard(text, transparency = 0.95) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                showFloatingMessage('Reply copied to clipboard!', false, transparency);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    showFloatingMessage('Reply copied to clipboard!', false, transparency);
                } catch (e) {
                    showFloatingMessage('Failed to copy to clipboard', true, transparency);
                }
                document.body.removeChild(textArea);
            }
        } catch (error) {
            showFloatingMessage('Failed to copy to clipboard', true, transparency);
        }
    }

    function promptForApiKey() {
        return new Promise((resolve, reject) => {
            try {
                const modal = document.createElement('div');
                modal.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.5);
                    z-index: 1000000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                `;

                const dialog = document.createElement('div');
                dialog.style.cssText = `
                    background: white;
                    padding: 24px;
                    border-radius: 8px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
                    max-width: 400px;
                    width: 90%;
                `;

                dialog.innerHTML = `
                    <h3 style="margin: 0 0 16px 0;">Gemini API Key Required</h3>
                    <p style="margin: 0 0 16px 0; color: #666;">
                        Please enter your Google Gemini API key.
                    </p>
                    <input type="password" placeholder="Enter API key..." style="
                        width: 100%; padding: 12px; border: 1px solid #ddd; 
                        border-radius: 4px; margin-bottom: 16px; box-sizing: border-box;
                    ">
                    <div style="text-align: right;">
                        <button style="margin-right: 8px; padding: 8px 16px; background: #ddd; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                        <button style="padding: 8px 16px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">Save</button>
                    </div>
                `;

                const input = dialog.querySelector('input');
                const cancelBtn = dialog.querySelector('button:first-of-type');
                const saveBtn = dialog.querySelector('button:last-of-type');

                cancelBtn.onclick = () => {
                    modal.remove();
                    resolve(null);
                };

                saveBtn.onclick = () => {
                    const apiKey = input.value.trim();
                    modal.remove();
                    resolve(apiKey);
                };

                input.onkeypress = (e) => {
                    if (e.key === 'Enter') saveBtn.click();
                };

                modal.appendChild(dialog);
                document.body.appendChild(modal);
                input.focus();
            } catch (error) {
                reject(error);
            }
        });
    }

    // Initialize function
    function initialize() {
        if (!extensionActive) {
            extensionActive = true;
        }

        addEventListeners();

        // Start periodic context check with longer interval
        if (contextCheckInterval) {
            clearInterval(contextCheckInterval);
        }

        contextCheckInterval = setInterval(() => {
            if (extensionActive && isChromeRuntimeAvailable()) {
                checkExtensionContext();
            }
        }, 10000);

        // Initial check
        checkExtensionContext();
    }

    // Initialize if chrome runtime is available
    if (isChromeRuntimeAvailable()) {
        initialize();
    } else {
        console.log('Chrome runtime not available, skipping extension initialization');
    }
})();