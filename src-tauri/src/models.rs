use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteModel {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
}

fn model_display_name(model: &RemoteModel) -> String {
    let display_name = model.display_name.trim();
    if display_name.is_empty() {
        model.id.clone()
    } else {
        display_name.to_owned()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub display_name: String,
    pub available_on: usize,
    pub requested_accounts: usize,
    pub unknown_accounts: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub options: Vec<ModelOption>,
    pub unknown_accounts: usize,
}

impl ModelCatalog {
    pub fn from_account_models(
        requested_accounts: usize,
        account_models: Vec<Result<Vec<RemoteModel>, String>>,
    ) -> Self {
        let mut accumulator = ModelCatalogAccumulator::new(requested_accounts);
        for result in account_models {
            accumulator.record_account_result(result);
        }
        accumulator.finish()
    }
}

/// Incrementally aggregates per-account model responses. The caller can feed
/// results as they arrive, so a large model lookup never retains one result
/// vector for every account. Memory is bounded by the in-flight requests plus
/// this model-ID dictionary.
pub(crate) struct ModelCatalogAccumulator {
    requested_accounts: usize,
    unknown_accounts: usize,
    options: Vec<ModelOption>,
    option_indexes: HashMap<String, usize>,
    id_fallbacks: HashSet<String>,
}

impl ModelCatalogAccumulator {
    pub(crate) fn new(requested_accounts: usize) -> Self {
        Self {
            requested_accounts,
            unknown_accounts: 0,
            options: Vec::new(),
            option_indexes: HashMap::new(),
            id_fallbacks: HashSet::new(),
        }
    }

    pub(crate) fn record_account_result(&mut self, result: Result<Vec<RemoteModel>, String>) {
        match result {
            Ok(models) => self.record_models(models),
            Err(_) => self.unknown_accounts += 1,
        }
    }

    pub(crate) fn finish(mut self) -> ModelCatalog {
        for option in &mut self.options {
            option.unknown_accounts = self.unknown_accounts;
        }
        ModelCatalog {
            options: self.options,
            unknown_accounts: self.unknown_accounts,
        }
    }

    fn record_models(&mut self, models: Vec<RemoteModel>) {
        let mut seen_in_account = HashSet::new();
        for model in models {
            if !seen_in_account.insert(model.id.clone()) {
                continue;
            }

            let uses_id_fallback = model.display_name.trim().is_empty();
            let display_name = model_display_name(&model);
            let model_id = model.id;
            if let Some(option_index) = self.option_indexes.get(&model_id).copied() {
                let option = &mut self.options[option_index];
                option.available_on += 1;
                if self.id_fallbacks.contains(&model_id) && !uses_id_fallback {
                    option.display_name = display_name;
                    self.id_fallbacks.remove(&model_id);
                }
                continue;
            }

            let option_index = self.options.len();
            self.option_indexes.insert(model_id.clone(), option_index);
            if uses_id_fallback {
                self.id_fallbacks.insert(model_id.clone());
            }
            self.options.push(ModelOption {
                id: model_id,
                display_name,
                available_on: 1,
                requested_accounts: self.requested_accounts,
                unknown_accounts: 0,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ModelCatalogAccumulator, RemoteModel};

    fn model(id: &str, display_name: &str) -> RemoteModel {
        RemoteModel {
            id: id.to_owned(),
            display_name: display_name.to_owned(),
        }
    }

    #[test]
    fn incrementally_aggregates_models_without_retaining_prior_account_results() {
        let mut accumulator = ModelCatalogAccumulator::new(3);
        accumulator.record_account_result(Ok(vec![model("gpt-5", "")]));
        accumulator.record_account_result(Err("offline".to_owned()));
        accumulator.record_account_result(Ok(vec![
            model("gpt-5", "GPT-5"),
            model("gpt-5.6-terra", "GPT-5.6 Terra"),
        ]));

        let catalog = accumulator.finish();
        let gpt5 = catalog
            .options
            .iter()
            .find(|option| option.id == "gpt-5")
            .expect("aggregated model option");

        assert_eq!(gpt5.available_on, 2);
        assert_eq!(gpt5.display_name, "GPT-5");
        assert_eq!(catalog.unknown_accounts, 1);
        assert_eq!(catalog.options.len(), 2);
    }
}
