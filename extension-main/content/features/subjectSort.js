// ============================================
// features/subjectSort.js
// Segregates subjects into Core and Other based on keywords
// ============================================

const SUBJECT_KEYWORDS = [
  "academic",
  "club",
  "misc",
  "miscellaneous",
  "revision",
  "sst",
  "other",
  "others",
  "posh",
  "session",
  "workshop",
  "workshops",
  "interview",
  "prep",
  "prep-",
];

function initSubjectSort() {
  if (!shouldHide("subject-sort")) {
    restoreSubjectSort();
    return;
  }

  if (!window.location.href.includes("/core-curriculum")) return;

  const container = document.querySelector(".m-l-20.m-r-20.m-t-20");
  if (!container) return;

  const subjectDivs = Array.from(container.querySelectorAll(".m-b-20"));
  // Only process if there are elements that haven't been processed
  if (
    subjectDivs.length === 0 ||
    subjectDivs.every((div) => div.hasAttribute("data-subject-processed"))
  )
    return;

  const coreSubjects = [];
  const otherSubjects = [];

  subjectDivs.forEach((div) => {
    div.setAttribute("data-subject-processed", "true");

    const nameEl = div.querySelector("._29EfoWpTY6mSoc0URgsgPl");
    if (nameEl) {
      const name = nameEl.textContent.toLowerCase();
      const hasKeyword = SUBJECT_KEYWORDS.some((kw) => name.includes(kw));
      if (hasKeyword) {
        otherSubjects.push(div);
      } else {
        coreSubjects.push(div);
      }
    } else {
      coreSubjects.push(div);
    }
  });

  let subjectCounter = 1;
  const processDiv = (type) => (div) => {
    const numEl = div.querySelector(".ZV1LrApmcV6Ae3HM7BSTK");
    if (
      numEl &&
      (numEl.textContent.includes("Subject -") ||
        numEl.hasAttribute("data-original-text"))
    ) {
      if (!numEl.hasAttribute("data-original-text")) {
        numEl.setAttribute("data-original-text", numEl.textContent);
      }

      numEl.innerHTML = "";
      numEl.appendChild(
        document.createTextNode(`Subject - ${subjectCounter++}`),
      );

      const tag = document.createElement("span");
      tag.className = "subject-sort-tag";
      tag.textContent = type === "core" ? "Core" : "Other";
      tag.style.marginLeft = "10px";
      tag.style.fontSize = "10px";
      tag.style.padding = "3px 6px";
      tag.style.borderRadius = "4px";
      tag.style.backgroundColor =
        type === "core" ? "rgba(0, 115, 255, 0.1)" : "rgba(100, 100, 100, 0.1)";
      tag.style.color = type === "core" ? "#0073ff" : "#666";
      tag.style.fontWeight = "700";
      tag.style.textTransform = "uppercase";
      tag.style.verticalAlign = "middle";
      tag.style.letterSpacing = "0.5px";
      numEl.appendChild(tag);
    }
    // Reorder by appending to container (moves it to the end)
    container.appendChild(div);
  };

  coreSubjects.forEach(processDiv("core"));
  otherSubjects.forEach(processDiv("other"));
}

function restoreSubjectSort() {
  // If toggled off, we can't easily restore the original order if the user navigated.
  // We can at least restore the original subject numbers.
  const container = document.querySelector(".m-l-20.m-r-20.m-t-20");
  if (container) {
    const subjectDivs = container.querySelectorAll(".m-b-20");
    subjectDivs.forEach((div) => {
      div.removeAttribute("data-subject-processed");
      const numEl = div.querySelector(".ZV1LrApmcV6Ae3HM7BSTK");
      if (numEl && numEl.hasAttribute("data-original-text")) {
        numEl.textContent = numEl.getAttribute("data-original-text");
      }
    });
  }
}

function observeSubjectList() {
  if (window._subjectSortObserver) return; // already watching

  const observer = new MutationObserver(() => {
    if (window.location.href.includes("/core-curriculum")) {
      const container = document.querySelector(".m-l-20.m-r-20.m-t-20");
      if (container) {
        const subjectDivs = Array.from(container.querySelectorAll(".m-b-20"));
        if (
          subjectDivs.length > 0 &&
          subjectDivs.some((div) => !div.hasAttribute("data-subject-processed"))
        ) {
          initSubjectSort();
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window._subjectSortObserver = observer;
}

// Global initialization hooked by content.js
setTimeout(observeSubjectList, 500);
