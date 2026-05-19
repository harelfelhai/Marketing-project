"""
app/api/v1/endpoints/schema.py — Domain A: Dynamic UI Form Schema.

Endpoint:
    GET /api/v1/schema/lead-form

Purpose:
    Returns the JSON schema consumed by DynamicForm.jsx on mount.
    The frontend renders exactly the fields returned here — no field
    name is ever hardcoded in the React component.

INTERNAL HOOK:
    In proprietary deployments, extend the `_BASELINE_FORM_FIELDS` list
    below (or replace the entire `lead_form_schema()` implementation)
    to expose additional company-specific fields. Because the frontend
    is a pure renderer of this response, no React code ever changes.
"""

from fastapi import APIRouter

from app.schemas.api_contracts import FormField, FormFieldOption, LeadFormSchemaResponse

router = APIRouter()


# ---------------------------------------------------------------------------
# Baseline schema — open-source generic fields.
#
# INTERNAL HOOK FOR ENGINEERS:
#   Replace or extend this list to add proprietary form fields.
#   The list order determines the UI rendering order.
#   Add new FormField entries without any frontend changes required.
# ---------------------------------------------------------------------------
_BASELINE_FORM_FIELDS: list[FormField] = [
    FormField(
        name="phone_number",
        type="tel",
        label="Phone Number",
        required=True,
        options=None,
    ),
    FormField(
        name="entity_type",
        type="text",
        label="Relationship Type",
        required=True,
        options=None,
    ),
    FormField(
        name="target_phone_number",
        type="tel",
        label="Target Phone Number",
        required=True,
        options=None,
    ),
    FormField(
        name="ingestion_source",
        type="select",
        label="Ingestion Source",
        required=True,
        options=[
            FormFieldOption(value="manual", label="Manual Entry"),
            FormFieldOption(value="automated", label="Automated System"),
        ],
    ),
    FormField(
        name="ingestion_reason",
        type="textarea",
        label="Ingestion Reason",
        required=False,
        options=None,
    ),
    FormField(
        name="entity_extra",
        type="json_blob",
        label="Entity Extra Data",
        required=False,
        options=None,
    ),
    FormField(
        name="phone_extra",
        type="json_blob",
        label="Phone Extra Data",
        required=False,
        options=None,
    ),
]


@router.get(
    "/lead-form",
    response_model=LeadFormSchemaResponse,
    summary="Fetch the dynamic form schema",
    description=(
        "Returns the complete JSON descriptor that DynamicForm.jsx uses to render "
        "the ingestion form. The frontend is a pure schema renderer — it has no "
        "hardcoded field names. Internal teams extend the form by modifying only "
        "the list returned here."
    ),
)
def lead_form_schema() -> LeadFormSchemaResponse:
    """
    Return the dynamic form field schema for the React ingestion UI.

    The response is a deterministic, stateless list of field descriptors.
    No database access is required — the schema is defined at the service
    layer and can be extended by internal teams without any frontend change.

    Returns:
        LeadFormSchemaResponse: The ordered list of form field descriptors.
    """
    # HOOK FOR INTERNAL ENGINEERS:
    # To extend the form with proprietary fields in your deployment,
    # either append to _BASELINE_FORM_FIELDS or replace this return
    # value with a richer schema assembled from your internal registry.
    return LeadFormSchemaResponse(fields=_BASELINE_FORM_FIELDS)
