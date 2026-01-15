const normalizeText = (text) => (text || "").replace(/\s+/g, " ").trim();

const findValueByLabel = (labelText) => {
  const labels = Array.from(document.querySelectorAll("label, th, td, span"));
  const label = labels.find((node) => normalizeText(node.textContent) === labelText);
  if (!label) {
    return "";
  }
  const sibling =
    label.closest("tr")?.querySelector("td:last-child") ||
    label.parentElement?.querySelector("span:last-child, td:last-child, div:last-child");
  return normalizeText(sibling?.textContent);
};

const extractBasicInfo = () => ({
  "اسم المنافسة": findValueByLabel("اسم المنافسة"),
  "رقم المنافسة": findValueByLabel("رقم المنافسة"),
  "الرقم المرجعي": findValueByLabel("الرقم المرجعي"),
  "الغرض من المنافسة": findValueByLabel("الغرض من المنافسة"),
  "قيمة وثائق المنافسة": findValueByLabel("قيمة وثائق المنافسة"),
  "مدة العقد": findValueByLabel("مدة العقد"),
  "نوع المنافسة": findValueByLabel("نوع المنافسة"),
  "الجهة الحكومية": findValueByLabel("الجهة الحكومية"),
  "طريقة تقديم العروض": findValueByLabel("طريقة تقديم العروض"),
});

const extractScheduleInfo = () => ({
  "آخر موعد لاستلام الاستفسارات": findValueByLabel("آخر موعد لاستلام الاستفسارات"),
  "آخر موعد لتقديم العروض": findValueByLabel("آخر موعد لتقديم العروض"),
});

const extractClassificationInfo = () => ({
  "مكان التنفيذ": findValueByLabel("مكان التنفيذ"),
  "تفاصيل التصنيف أو النشاط": findValueByLabel("التصنيف") || findValueByLabel("النشاط"),
});

const extractBoqTables = () => {
  const tables = Array.from(document.querySelectorAll("table"));
  const rows = [];
  tables.forEach((table) => {
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
      normalizeText(th.textContent)
    );
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    bodyRows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
        normalizeText(cell.textContent)
      );
      if (!cells.length) {
        return;
      }
      const rowData = {
        "رقم البند": cells[headers.indexOf("رقم البند")] || cells[0],
        الوصف: cells[headers.indexOf("الوصف")] || cells[1],
        الوحدة: cells[headers.indexOf("الوحدة")] || "",
        الكمية: cells[headers.indexOf("الكمية")] || "",
        السعر: cells[headers.indexOf("السعر")] || "",
        المبلغ: cells[headers.indexOf("المبلغ")] || "",
        المواصفات: cells[headers.indexOf("المواصفات")] || "",
        القسم: cells[headers.indexOf("القسم")] || "",
      };
      rows.push([
        rowData["رقم البند"] || "",
        rowData["الوصف"] || "",
        rowData["الوحدة"] || "",
        rowData["الكمية"] || "",
        rowData["السعر"] || "",
        rowData["المبلغ"] || "",
        rowData["المواصفات"] || "",
        rowData["القسم"] || "",
        window.location.href,
      ]);
    });
  });
  return rows;
};

const extractEvaluationCriteria = () => {
  const criteriaSection =
    document.querySelector("[data-section='evaluation']") ||
    Array.from(document.querySelectorAll("h2, h3")).find((node) =>
      normalizeText(node.textContent).includes("معايير التقييم")
    )?.parentElement;

  if (!criteriaSection) {
    return [];
  }

  const items = Array.from(criteriaSection.querySelectorAll("li"));
  if (items.length) {
    return items.map((item) => [normalizeText(item.textContent), ""]);
  }

  const rows = Array.from(criteriaSection.querySelectorAll("tr")).map((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
      normalizeText(cell.textContent)
    );
    return [cells[0] || "", cells[1] || ""];
  });

  return rows.filter((row) => row.some(Boolean));
};

const extractAttachments = async () => {
  const attachmentLinks = Array.from(document.querySelectorAll("a"))
    .filter((link) => /download|attachment|مرفق/.test(link.href + link.textContent))
    .slice(0, 20);
  const attachments = [];
  for (const link of attachmentLinks) {
    try {
      const response = await fetch(link.href);
      const blob = await response.blob();
      attachments.push({
        name: normalizeText(link.textContent) || "attachment",
        blob,
      });
    } catch (error) {
      console.warn("Attachment fetch failed", error);
    }
  }
  return attachments;
};

const detectPage = () => {
  const title = normalizeText(document.title);
  const hasCompetition = Boolean(findValueByLabel("اسم المنافسة")) || title.includes("منافسة");
  return { hasCompetition, title };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "DETECT_PAGE") {
    sendResponse(detectPage());
    return;
  }

  if (message.type === "EXTRACT_PROJECT") {
    const projectInfo = {
      ...extractBasicInfo(),
      ...extractScheduleInfo(),
      ...extractClassificationInfo(),
    };
    Promise.resolve()
      .then(async () => ({
        projectInfo,
        boqRows: extractBoqTables(),
        evaluationRows: extractEvaluationCriteria(),
        attachments: await extractAttachments(),
      }))
      .then((payload) => sendResponse(payload))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});
