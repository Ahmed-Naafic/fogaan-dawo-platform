# Mock data (Phase 1 only)

Everything in this folder is **static demo content** used to render the approved
visual design. It is not fetched, persisted or mutated.

In Phase 2 each export here will be replaced by a call in `src/services/` that hits
the real API. Pages import data only through `src/services/*`, so swapping
the source will not require changing any page or component.

Portrait images in `src/assets/images/` are cropped from the approved design
references so the build matches them. Replace them with licensed, high-resolution
photography before production.
