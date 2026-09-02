<script setup>
import { ref, onMounted } from "vue";

const props = defineProps({
  schema: { type: String, required: true },
});

const loaded = ref(false);
const failed = ref(false);
const json = ref("");

onMounted(async () => {
  try {
    const res = await fetch(props.schema);
    if (!res.ok) throw new Error(String(res.status));
    json.value = JSON.stringify(await res.json(), null, 2);
    loaded.value = true;
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <p>
    <a :href="schema" class="schema-download">Download {{ schema.split('/').pop() }}</a>
  </p>
  <p v-if="failed" class="schema-failed">Failed to load schema document.</p>
  <details v-if="loaded" class="schema-details" open>
    <summary>Rendered schema document</summary>
    <pre class="schema-pre"><code>{{ json }}</code></pre>
  </details>
  <p v-if="!loaded && !failed">Loading schema…</p>
</template>

<style>
.schema-details {
  margin: 1rem 0;
}
.schema-details summary {
  cursor: pointer;
  font-weight: 600;
}
.schema-pre {
  max-height: 28rem;
  overflow: auto;
  font-size: 0.8rem;
  line-height: 1.5;
  background: var(--vp-code-block-bg);
  padding: 1rem;
  border-radius: 8px;
}
.schema-download {
  font-weight: 500;
}
.schema-failed {
  color: var(--vp-c-danger-1);
}
</style>
