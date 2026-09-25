class CactiController < ApplicationController
  def index
    render json: Cactus.order(:name)
  end
end
