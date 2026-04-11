// ============================================================
// problemPicker.js
// Fetches unsolved problems from Scaler and picks a random one
// ============================================================

class ProblemPicker {
  constructor() {
    this.problems = [];
    this.loaded = false;
  }

  /**
   * Fetch problems data from Scaler API and cache the unsolved list.
   */
  async fetchProblems() {
    const res = await fetch(
      "https://www.scaler.com/academy/mentee/problems-data",
      { credentials: "include" },
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch problems: HTTP ${res.status}`);
    }

    const data = await res.json();

    // Filter only unsolved problems
    const all = Object.values(data.problems || {});
    this.problems = all.filter((p) => p.status === "unsolved");
    this.loaded = true;

    return this.problems;
  }

  /**
   * Returns a random unsolved problem object.
   * Fetches fresh data if not cached.
   */
  async pickRandom() {
    if (!this.loaded || this.problems.length === 0) {
      await this.fetchProblems();
    }

    if (this.problems.length === 0) {
      return null;
    }

    const idx = Math.floor(Math.random() * this.problems.length);
    return this.problems[idx];
  }

  /**
   * Build the problem URL from a problem object.
   */
  static buildUrl(problem) {
    const segment = problem.type === "assignment" ? "assignment" : "homework";
    return `https://www.scaler.com/academy/mentee-dashboard/class/${problem.sbat_id}/${segment}/problems/${problem.ib_problem_id}`;
  }
}

async function initProblemPicker() {
  // Check if feature is enabled in settings
  if (
    typeof currentSettings !== "undefined" &&
    !currentSettings["problem-picker"]
  ) {
    return;
  }

  // Look for the "Practice" section header
  const sectionHeaders = document.querySelectorAll(".section-header__content");

  for (const header of sectionHeaders) {
    const title = header.querySelector(".section-header__title");
    if (title && title.textContent.trim() === "Practice") {
      // Guard: already injected in this specific header?
      if (
        header.dataset.pickerInjected === "true" ||
        header.querySelector(".scaler-pick-random-btn")
      ) {
        continue;
      }

      // Mark as injected IMMEDIATELY
      header.dataset.pickerInjected = "true";

      // Add the "Pick random" button
      const pickButton = document.createElement("button");
      pickButton.className = "scaler-pick-random-btn";
      pickButton.innerHTML = `Pick Random`;

      const picker = new ProblemPicker();

      pickButton.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const originalText = pickButton.innerHTML;
        pickButton.innerHTML = "Fetching...";
        pickButton.disabled = true;

        try {
          const problem = await picker.pickRandom();
          if (problem) {
            const url = ProblemPicker.buildUrl(problem);
            window.open(url, "_blank");
          } else {
            alert("Scaler++: No unsolved problems found in your dashboard!");
          }
        } catch (err) {
          console.error("Scaler++: Error picking random problem:", err);
          // alert(
          //   "Scaler++: Failed to fetch problems. Please make sure you are logged in to Scaler.",
          // );
        } finally {
          pickButton.innerHTML = originalText;
          pickButton.disabled = false;
        }
      };

      header.appendChild(pickButton);
    }
  }
}
