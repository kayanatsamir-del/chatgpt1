const GOOGLE_API_BASE = "https://www.googleapis.com";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

const sendProgress = (step, status, message) => {
  chrome.runtime.sendMessage({ type: "PROGRESS", step, status, message });
};

const getAuthToken = () =>
  new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("لا يمكن الحصول على رمز المصادقة"));
        return;
      }
      resolve(token);
    });
  });

const apiRequest = async (token, url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API Error (${response.status}): ${errorText}`);
  }
  return response.json();
};

const ensureFolder = async (token, projectName) => {
  const metadata = {
    name: projectName,
    mimeType: DRIVE_FOLDER_MIME,
  };
  const response = await apiRequest(
    token,
    `${GOOGLE_API_BASE}/drive/v3/files`,
    {
      method: "POST",
      body: JSON.stringify(metadata),
    }
  );
  return response.id;
};

const createSheet = async (token, folderId, projectName) => {
  const metadata = {
    name: `${projectName} - Etimad`,
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: [folderId],
  };
  const response = await apiRequest(
    token,
    `${GOOGLE_API_BASE}/drive/v3/files`,
    {
      method: "POST",
      body: JSON.stringify(metadata),
    }
  );
  return response.id;
};

const updateValues = async (token, spreadsheetId, range, values) => {
  await apiRequest(
    token,
    `${GOOGLE_API_BASE}/sheets/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ range, values }),
    }
  );
};

const ensureSheets = async (token, spreadsheetId) => {
  const response = await apiRequest(
    token,
    `${GOOGLE_API_BASE}/sheets/v4/spreadsheets/${spreadsheetId}`,
    { method: "GET" }
  );
  const sheetTitles = response.sheets.map((sheet) => sheet.properties.title);
  const requests = [];
  const requiredSheets = ["معلومات المشروع", "جداول الكميات", "معايير التقييم"];
  requiredSheets.forEach((title) => {
    if (!sheetTitles.includes(title)) {
      requests.push({
        addSheet: {
          properties: { title },
        },
      });
    }
  });
  if (requests.length) {
    await apiRequest(
      token,
      `${GOOGLE_API_BASE}/sheets/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({ requests }),
      }
    );
  }
};

const writeProjectInfo = async (token, spreadsheetId, info) => {
  const values = [
    ["الحقول", "القيمة"],
    ...Object.entries(info).map(([label, value]) => [label, value || ""]),
  ];
  await updateValues(token, spreadsheetId, "معلومات المشروع!A1:B50", values);
};

const writeBoqTables = async (token, spreadsheetId, boqRows) => {
  const header = [
    "رقم البند",
    "الوصف",
    "الوحدة",
    "الكمية",
    "السعر",
    "المبلغ",
    "المواصفات",
    "القسم",
    "المصدر",
  ];
  const values = [header, ...boqRows];
  await updateValues(token, spreadsheetId, "جداول الكميات!A1:I2000", values);
};

const writeEvaluation = async (token, spreadsheetId, rows) => {
  if (!rows.length) {
    await updateValues(token, spreadsheetId, "معايير التقييم!A1:B2", [
      ["المعيار", "القيمة"],
      ["لا توجد معايير تقييم في الصفحة", ""],
    ]);
    return;
  }
  const values = [["المعيار", "القيمة"], ...rows];
  await updateValues(token, spreadsheetId, "معايير التقييم!A1:B200", values);
};

const uploadAttachment = async (token, folderId, attachment) => {
  const formData = new FormData();
  formData.append(
    "metadata",
    new Blob([JSON.stringify({ name: attachment.name, parents: [folderId] })], {
      type: "application/json",
    })
  );
  formData.append("file", attachment.blob);
  const response = await fetch(
    `${GOOGLE_API_BASE}/upload/drive/v3/files?uploadType=multipart`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Drive upload failed: ${errorText}`);
  }
  return response.json();
};

const extractFromTab = async (tabId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PROJECT" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });

const detectPage = async (tabId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "DETECT_PAGE" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });

const handleExport = async ({ tabId, sheetId }) => {
  sendProgress("page", "done", "تم التعرف على الصفحة.");
  sendProgress("extract", "done", "جارٍ استخراج البيانات...");
  const payload = await extractFromTab(tabId);
  sendProgress("extract", "done", "تم استخراج البيانات بنجاح.");

  const token = await getAuthToken();
  const projectName = payload.projectInfo["اسم المنافسة"] || "مشروع اعتماد";

  sendProgress("sheet", "done", "إنشاء المجلد وملف Sheets...");
  const folderId = await ensureFolder(token, projectName);
  const targetSheetId = sheetId || (await createSheet(token, folderId, projectName));
  await ensureSheets(token, targetSheetId);
  await writeProjectInfo(token, targetSheetId, payload.projectInfo);
  await writeBoqTables(token, targetSheetId, payload.boqRows);
  await writeEvaluation(token, targetSheetId, payload.evaluationRows);
  sendProgress("sheet", "done", "تمت كتابة البيانات في Google Sheets.");

  sendProgress("attachments", "done", "رفع المرفقات إلى Drive...");
  for (const attachment of payload.attachments) {
    await uploadAttachment(token, folderId, attachment);
  }
  sendProgress("attachments", "done", "تم رفع جميع المرفقات.");
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_EXPORT") {
    handleExport(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendProgress("attachments", "error", error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "DETECT_PAGE") {
    detectPage(message.tabId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
