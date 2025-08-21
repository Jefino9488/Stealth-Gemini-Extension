// Service Worker for handling API calls and context menu
let apiKey = null;
let systemPrompt = 'You are a helpful AI assistant specialized in answering quiz questions, forms, and academic content. Provide accurate, concise answers.';
let transparency = 0.95;

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
    // Create context menu items
    chrome.contextMenus.create({
        id: 'analyze-text',
        title: 'Analyze with Gemini',
        contexts: ['selection']
    });

    chrome.contextMenus.create({
        id: 'reply-text',
        title: 'Reply with Gemini',
        contexts: ['selection']
    });
});

// Load settings on startup
chrome.storage.sync.get(['geminiApiKey', 'systemPrompt', 'transparency'], (result) => {
    if (result.geminiApiKey) {
        apiKey = result.geminiApiKey;
    }
    if (result.systemPrompt) {
        systemPrompt = result.systemPrompt;
    }
    if (result.transparency !== undefined) {
        transparency = result.transparency;
    }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!apiKey) {
        await promptForApiKey();
        if (!apiKey) return;
    }

    const selectedText = info.selectionText;

    try {
        let response;
        if (info.menuItemId === 'analyze-text') {
            // Enhanced prompt for quiz/form questions
            const analysisPrompt = `${systemPrompt}

You are helping with quiz/form questions. If the selected text contains:
- Multiple choice questions: Identify the correct answer and explain briefly
- True/false questions: State the answer and reasoning
- Fill-in-the-blank: Provide the answer
- Essay questions: Provide key points to cover
- Any other question type: Give a direct, helpful response

Selected text: "${selectedText}"

Provide a clear, concise answer focusing on what's being asked.`;

            response = await callGeminiAPI(analysisPrompt);
            // Send response to content script for display
            await ensureContentScriptAndSendMessage(tab.id, {
                type: 'showResponse',
                data: response,
                transparency: transparency
            });
        } else if (info.menuItemId === 'reply-text') {
            response = await callGeminiAPI(`${systemPrompt}\n\nGenerate a thoughtful reply to this text: "${selectedText}"`);
            // Copy to clipboard and show notification
            await ensureContentScriptAndSendMessage(tab.id, {
                type: 'copyToClipboard',
                data: response,
                transparency: transparency
            });
        }
    } catch (error) {
        await ensureContentScriptAndSendMessage(tab.id, {
            type: 'showError',
            data: 'Failed to get response from Gemini API: ' + error.message
        });
    }
});

// Ensure content script is injected and send message
async function ensureContentScriptAndSendMessage(tabId, message) {
    try {
        // First try to ping the content script
        await chrome.tabs.sendMessage(tabId, {type: 'ping'});
        // If successful, send the actual message
        await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
        console.log('Content script not responding, injecting...');
        try {
            // Inject content script
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });

            // Wait for content script to initialize
            await new Promise(resolve => setTimeout(resolve, 200));

            // Try sending message again
            await chrome.tabs.sendMessage(tabId, message);
        } catch (injectionError) {
            console.log('Failed to inject content script or send message:', injectionError);
        }
    }
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle async operations properly
    (async () => {
        try {
            if (request.type === 'ping') {
                sendResponse({pong: true});
            } else if (request.type === 'askGemini') {
                if (!apiKey) {
                    await promptForApiKey();
                    if (!apiKey) {
                        sendResponse({ error: 'API key required' });
                        return;
                    }
                }

                try {
                    // Get page context for popup questions if requested
                    let pageContext = '';
                    if (request.useContext !== false) { // Default to true if not specified
                        try {
                            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                            if (tab && tab.id) {
                                // Ensure content script is available for context
                                try {
                                    await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
                                } catch (pingError) {
                                    // Inject content script if not available
                                    await chrome.scripting.executeScript({
                                        target: { tabId: tab.id },
                                        files: ['content.js']
                                    });
                                    await new Promise(resolve => setTimeout(resolve, 200));
                                }

                                const contextResponse = await chrome.tabs.sendMessage(tab.id, { type: 'getPageContext' });
                                if (contextResponse && contextResponse.context) {
                                    pageContext = contextResponse.context;
                                }
                            }
                        } catch (contextError) {
                            console.log('Could not get page context:', contextError);
                        }
                    }

                    let fullPrompt = systemPrompt + '\n\n';

                    if (pageContext && request.useContext !== false) {
                        fullPrompt += `Context from current webpage:
---
${pageContext}
---

Based on the above context and your knowledge, please answer: ${request.question}`;
                    } else {
                        fullPrompt += request.question;
                    }

                    const response = await callGeminiAPI(fullPrompt);
                    sendResponse({ response: response });
                } catch (error) {
                    sendResponse({ error: error.message });
                }
            } else if (request.type === 'saveSettings') {
                const settings = request.settings;
                apiKey = settings.apiKey;
                systemPrompt = settings.systemPrompt;
                transparency = settings.transparency;

                await chrome.storage.sync.set({
                    geminiApiKey: settings.apiKey,
                    systemPrompt: settings.systemPrompt,
                    transparency: settings.transparency
                });
                sendResponse({ success: true });
            } else if (request.type === 'getSettings') {
                sendResponse({
                    apiKey: apiKey,
                    systemPrompt: systemPrompt,
                    transparency: transparency
                });
            } else if (request.type === 'analyzeText') {
                // Handle floating icon analysis
                if (!apiKey) {
                    await promptForApiKey();
                    if (!apiKey) {
                        chrome.tabs.sendMessage(sender.tab.id, {
                            type: 'analyzeError',
                            data: 'API key required',
                            transparency: transparency
                        });
                        return;
                    }
                }

                try {
                    const analysisPrompt = `${systemPrompt}

You are helping with quiz/form questions. If the selected text contains:
- Multiple choice questions: Identify the correct answer and explain briefly
- True/false questions: State the answer and reasoning  
- Fill-in-the-blank: Provide the answer
- Essay questions: Provide key points to cover
- Any other question type: Give a direct, helpful response

Selected text: "${request.text}"

Provide a clear, concise answer focusing on what's being asked.`;

                    const response = await callGeminiAPI(analysisPrompt);
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: 'analyzeComplete',
                        data: response,
                        transparency: transparency
                    });
                } catch (error) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: 'analyzeError',
                        data: 'Analysis failed: ' + error.message,
                        transparency: transparency
                    });
                }
            } else {
                sendResponse({ error: 'Unknown request type' });
            }
        } catch (error) {
            console.error('Background script error:', error);
            sendResponse({ error: 'Internal error: ' + error.message });
        }
    })();

    return true; // Keep message channel open for async response
});

// Prompt user for API key
async function promptForApiKey() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (!tabs[0]) {
                resolve();
                return;
            }

            try {
                // Ensure content script is available
                await ensureContentScriptAndSendMessage(tabs[0].id, {type: 'ping'});

                const response = await chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'promptApiKey'
                });

                if (response && response.apiKey) {
                    apiKey = response.apiKey;
                    chrome.storage.sync.set({
                        geminiApiKey: apiKey,
                        systemPrompt: systemPrompt,
                        transparency: transparency
                    });
                }
                resolve();
            } catch (error) {
                console.log('Could not prompt for API key:', error);
                resolve();
            }
        });
    });
}

// Call Gemini API
async function callGeminiAPI(prompt) {
    // Keep service worker alive during API call
    const keepAlive = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {});
    }, 20000);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 2048
                },
                safetySettings: [
                    {
                        category: 'HARM_CATEGORY_HARASSMENT',
                        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                    },
                    {
                        category: 'HARM_CATEGORY_HATE_SPEECH',
                        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                    },
                    {
                        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                    },
                    {
                        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                    }
                ]
            })
        });

        clearInterval(keepAlive);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            return data.candidates[0].content.parts[0].text;
        } else if (data.error) {
            throw new Error(`API Error: ${data.error.message}`);
        } else {
            throw new Error('Unexpected API response format');
        }
    } catch (error) {
        clearInterval(keepAlive);
        throw error;
    }
}