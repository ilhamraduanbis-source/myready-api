# Address reference provenance

`postcodes.json` is a compact transformed snapshot downloaded on 2026-09-24 from the Government of Malaysia open data catalogue's Postcode Dataset. The catalogue identifies the Malaysian Communications and Multimedia Commission as the data source:

https://data.gov.my/data-catalogue/poskod

The source describes the dataset as an annual lookup of Malaysian postcodes to city and state. MYReady uses it only for deterministic local reference and returns the snapshot version in every resolver response.

Limitations: the dataset does not prove that a physical address exists, identify a building, provide coordinates, or guarantee deliverability. MYReady does not present derived resolution as government validation.

The source dataset is licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/
