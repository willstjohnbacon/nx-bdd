export interface SetupE2eGeneratorSchema {
  /** The Nx Playwright application to configure. */
  project: string;
  /** Glob for Cucumber feature files, relative to the project root. */
  featuresGlob?: string;
  /** Glob for step definition files, relative to the project root. */
  stepsGlob?: string;
  /** Default URL the browser navigates to, used when BASE_URL is unset. */
  baseUrl?: string;
  /** Default base URL of the HTTP API backing the suite, used when API_BASE_URL is unset. */
  apiBaseUrl?: string;
  /** Skip formatting the generated files. */
  skipFormat?: boolean;
  /** Skip adding the BDD and Allure dependencies to package.json. */
  skipPackageJson?: boolean;
}
