import DefaultTheme from "vitepress/theme";
import SchemaViewer from "./SchemaViewer.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("SchemaViewer", SchemaViewer);
  },
};
