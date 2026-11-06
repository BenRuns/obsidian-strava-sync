export class FileSelector {
  type: string;

  constructor(type: string) {
    this.type = type;
  }

  selectContents(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create an input element for file selection
      const fileInput = createEl("input");
      fileInput.type = "file";
      fileInput.accept = this.type;

      // Handle file selection
      fileInput.onchange = async (event) => {
        const files = (event.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          const file = files[0];
          try {
            const fileContents = await file.text();
            resolve(fileContents);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        } else {
          reject(new Error("No file selected"));
        }
      };

      // Programmatically open the file dialog
      fileInput.click();
    });
  }
}
