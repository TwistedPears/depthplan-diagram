Rails.application.routes.draw do
  resources :people, only: [:index, :update]
  resources :cacti, only: [:index]
  namespace :admin do
    resources :people, only: [:index]
  end
end
