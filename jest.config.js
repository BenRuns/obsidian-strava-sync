module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "js"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.[tj]s$": "ts-jest",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: ["node_modules/(?!(csv-parse|@garmin/fitsdk)/)"],
};
